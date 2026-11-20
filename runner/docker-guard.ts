// Software Factory – Docker-Wächter (Docker-out-of-Docker)
//
// Jeder Bau- und Abnahme-Job bekommt statt des echten Docker-Sockets einen eigenen Socket dieses Wächters.
// Der Agent kann damit Images bauen und Test-Container (Postgres, Redis, Weaviate, eigene Dienste) starten,
// aber nur die Ressourcen sehen und ändern, die sein Job selbst angelegt hat (Label sf.owner=<job>).
// Produktive Container, Netze, Volumes und Images auf demselben Server bleiben unerreichbar:
//   - kein privileged, keine Capabilities, keine Geräte/GPU, kein host-Netz/-PID/-IPC
//   - Bind-Mounts nur aus /work (dem Job-Ordner), Volumes nur eigene, keine Volume-Treiber-Tricks
//   - Builds nur über den klassischen Builder (POST /build), dessen Parameter geprüft werden können.
//     BuildKit (/grpc, /session) ist gesperrt: Der Job setzt DOCKER_BUILDKIT=0.
//   - keine Image-Tags, die schon einem fremden Image gehören (sonst ließe sich ein Produktiv-Image ersetzen)
//   - Speicher-, Prozess- und CPU-Grenzen pro Container, begrenzte Anzahl Container pro Job
// Alles, was nicht ausdrücklich erlaubt ist, wird abgelehnt.

import { createServer, connect, type Server, type Socket } from "node:net";
import { request } from "node:http";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { dirname, posix } from "node:path";

export type GuardOptions = {
  /** Name des Job-Containers. Wert des Labels sf.owner an allem, was der Job anlegt. */
  owner: string;
  /** Netz des Job-Containers. Container ohne eigenes Netz landen hier und sind per Name erreichbar. */
  network: string;
  /** Pfad des Job-Ordners auf dem Server. Im Job heißt er /work. */
  hostWorkDir: string;
  /** Echter Docker-Socket */
  upstream?: string;
  /** Grenzen pro Container */
  memoryBytes?: number;
  nanoCpus?: number;
  pids?: number;
  maxContainers?: number;
};

export const OWNER_LABEL = "sf.owner";
const KB = 1024, MB = KB * 1024, GB = MB * 1024;

/** "4g" → Bytes */
export function parseBytes(v: string | number | undefined, fallback: number): number {
  if (typeof v === "number") return v;
  const m = String(v ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/);
  if (!m) return fallback;
  return Math.round(Number(m[1]) * ({ "": 1, k: KB, m: MB, g: GB } as Record<string, number>)[m[2]]);
}

/** Antworten, die der Wächter selbst gibt */
export class Deny extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}

/** Was der Wächter vom echten Docker wissen muss (in Tests ersetzbar) */
export type DockerApi = {
  get(path: string): Promise<{ status: number; json: any }>;
  send(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; raw: string }>;
};

export type Req = { method: string; path: string; query: URLSearchParams; prefix: string };

const json = (b: Buffer | undefined) => {
  if (!b || b.length === 0) return {};
  try { return JSON.parse(b.toString("utf8")); } catch { throw new Deny("Ungültiger JSON-Body", 400); }
};

// ---------- Eigentum ----------

const labelsOf = (obj: any): Record<string, string> => obj?.Config?.Labels ?? obj?.Labels ?? {};
const ownedBy = (obj: any, owner: string) => labelsOf(obj)[OWNER_LABEL] === owner;

async function ownedContainer(api: DockerApi, o: GuardOptions, id: string): Promise<any> {
  const r = await api.get(`/containers/${encodeURIComponent(id)}/json`);
  if (r.status === 404) throw new Deny(`Container ${id} nicht gefunden`, 404);
  if (r.status !== 200 || !ownedBy(r.json, o.owner)) throw new Deny(`Container ${id} gehört nicht zu diesem Job`);
  return r.json;
}

async function ownedNetwork(api: DockerApi, o: GuardOptions, id: string): Promise<any> {
  const r = await api.get(`/networks/${encodeURIComponent(id)}`);
  if (r.status === 404) throw new Deny(`Netz ${id} nicht gefunden`, 404);
  if (r.status !== 200 || !ownedBy(r.json, o.owner)) {
    throw new Deny(`Netz ${id} gehört nicht zu diesem Job. Produktive Netze (z. B. backend, automation) sind gesperrt, nutze ein eigenes Netz.`);
  }
  return r.json;
}

async function ownedVolume(api: DockerApi, o: GuardOptions, name: string): Promise<any> {
  const r = await api.get(`/volumes/${encodeURIComponent(name)}`);
  if (r.status === 404) throw new Deny(`Volume ${name} nicht gefunden`, 404);
  if (r.status !== 200 || !ownedBy(r.json, o.owner)) throw new Deny(`Volume ${name} gehört nicht zu diesem Job`);
  return r.json;
}

async function ownedImage(api: DockerApi, o: GuardOptions, name: string): Promise<any> {
  const r = await api.get(`/images/${name}/json`);
  if (r.status === 404) throw new Deny(`Image ${name} nicht gefunden`, 404);
  if (r.status !== 200 || !ownedBy(r.json, o.owner)) throw new Deny(`Image ${name} wurde nicht von diesem Job gebaut`);
  return r.json;
}

/** "repo" → "repo:latest", "host:5000/repo" → "host:5000/repo:latest" */
export const withTag = (t: string) => (t.slice(t.lastIndexOf("/") + 1).includes(":") ? t : `${t}:latest`);

/** Ein Tag darf nur gesetzt werden, wenn es frei ist oder schon einem eigenen Image gehört. */
async function tagUsable(api: DockerApi, o: GuardOptions, tag: string) {
  const r = await api.get(`/images/${tag}/json`);
  if (r.status === 404) return;
  if (r.status === 200 && ownedBy(r.json, o.owner)) return;
  throw new Deny(`Das Image-Tag ${tag} gehört schon einem anderen Image auf dem Server (evtl. produktiv). ` +
    `Nimm ein eigenes Tag, z. B. sf-test-…, bei Compose einen eigenen Projektnamen: docker compose -p sf-test …`);
}

// ---------- Mounts ----------

/** /work/... im Job → Pfad auf dem Server. Alles andere ist gesperrt. */
export function hostPath(o: GuardOptions, source: string): string {
  const p = posix.normalize(source);
  if (p === "/work" || p.startsWith("/work/")) return o.hostWorkDir.replace(/\/+$/, "") + p.slice("/work".length);
  throw new Deny(`Bind-Mount ${source} ist gesperrt. Erlaubt sind nur Pfade unter /work (dein Job-Ordner, z. B. /work/repo/...). ` +
    `Für Daten nimm ein Volume oder tmpfs.`);
}

async function volumeUsable(api: DockerApi, o: GuardOptions, name: string) {
  const r = await api.get(`/volumes/${encodeURIComponent(name)}`);
  if (r.status === 200) {
    if (!ownedBy(r.json, o.owner)) throw new Deny(`Volume ${name} gehört nicht zu diesem Job`);
    return;
  }
  // Neues benanntes Volume: mit Eigentümer anlegen, bevor Docker es ohne Label erzeugt
  const c = await api.send("POST", "/volumes/create", { Name: name, Labels: { [OWNER_LABEL]: o.owner } });
  if (c.status >= 300) throw new Deny(`Volume ${name} konnte nicht angelegt werden: ${c.raw}`, 500);
}

const isBindSource = (s: string) => s.startsWith("/") || s.startsWith(".") || s.startsWith("~");

// ---------- Container anlegen ----------

const ALLOWED_NS = new Set(["", "private", "shareable"]);

async function checkNamespace(api: DockerApi, o: GuardOptions, kind: string, mode: unknown) {
  const m = String(mode ?? "");
  if (ALLOWED_NS.has(m)) return;
  if (m.startsWith("container:")) { await ownedContainer(api, o, m.slice("container:".length)); return; }
  throw new Deny(`${kind}=${m} ist gesperrt`);
}

/** Netzname aus der Sicht des Agents → tatsächliches Netz (Standardnetze werden zum Job-Netz) */
async function mapNetwork(api: DockerApi, o: GuardOptions, name: string): Promise<string> {
  if (name === "" || name === "default" || name === "bridge") return o.network;
  if (name === "none") return name;
  if (name === "host") throw new Deny("network_mode host ist gesperrt");
  if (name.startsWith("container:")) { await ownedContainer(api, o, name.slice("container:".length)); return name; }
  await ownedNetwork(api, o, name);
  return name;
}

export async function checkContainerCreate(api: DockerApi, o: GuardOptions, body: any): Promise<any> {
  const b = { ...body };
  const hc = { ...(b.HostConfig ?? {}) };
  const memory = o.memoryBytes ?? 4 * GB, pids = o.pids ?? 1024, cpus = o.nanoCpus ?? 2e9;

  if (hc.Privileged) throw new Deny("privileged ist gesperrt");
  if ((hc.CapAdd ?? []).length) throw new Deny(`Zusätzliche Capabilities (${hc.CapAdd.join(", ")}) sind gesperrt`);
  if ((hc.Devices ?? []).length || (hc.DeviceCgroupRules ?? []).length) throw new Deny("Geräte sind gesperrt");
  if ((hc.DeviceRequests ?? []).length) throw new Deny("GPUs sind gesperrt: Die GPUs gehören den produktiven Diensten. Tests laufen auf der CPU.");
  if (hc.Runtime && hc.Runtime !== "runc") throw new Deny(`Runtime ${hc.Runtime} ist gesperrt`);
  if (hc.CgroupParent || hc.Cgroup === "host") throw new Deny("Cgroup-Einstellungen sind gesperrt");
  if (hc.MaskedPaths != null || hc.ReadonlyPaths != null) throw new Deny("MaskedPaths/ReadonlyPaths sind gesperrt");
  if (hc.VolumeDriver) throw new Deny("Volume-Treiber sind gesperrt");
  if (hc.StorageOpt && Object.keys(hc.StorageOpt).length) throw new Deny("StorageOpt ist gesperrt");
  if (hc.OomKillDisable || (hc.OomScoreAdj ?? 0) < 0) throw new Deny("OOM-Schutz vor produktiven Diensten ist gesperrt");
  if (hc.PublishAllPorts) throw new Deny("-P (alle Ports veröffentlichen) ist gesperrt. Container sind im Job-Netz per Name erreichbar.");
  for (const s of hc.SecurityOpt ?? []) {
    if (!String(s).startsWith("no-new-privileges")) throw new Deny(`security-opt ${s} ist gesperrt`);
  }
  const logType = hc.LogConfig?.Type ?? "";
  if (!["", "json-file", "local"].includes(logType)) throw new Deny(`Log-Treiber ${logType} ist gesperrt`);
  await checkNamespace(api, o, "pid", hc.PidMode);
  await checkNamespace(api, o, "ipc", hc.IpcMode);
  if (hc.UTSMode && hc.UTSMode !== "") throw new Deny(`uts=${hc.UTSMode} ist gesperrt`);
  if (hc.UsernsMode && hc.UsernsMode !== "") throw new Deny(`userns=${hc.UsernsMode} ist gesperrt`);
  if (hc.CgroupnsMode && hc.CgroupnsMode !== "private") throw new Deny(`cgroupns=${hc.CgroupnsMode} ist gesperrt`);
  for (const v of hc.VolumesFrom ?? []) await ownedContainer(api, o, String(v).split(":")[0]);
  for (const l of hc.Links ?? []) await ownedContainer(api, o, String(l).split(":")[0].replace(/^\//, ""));

  // Bind-Mounts und Volumes
  if (hc.Binds) {
    const binds: string[] = [];
    for (const bind of hc.Binds as string[]) {
      const [src, ...rest] = String(bind).split(":");
      if (rest.length === 0) { binds.push(bind); continue; }            // anonymes Volume
      if (isBindSource(src)) binds.push([hostPath(o, src), ...rest].join(":"));
      else { await volumeUsable(api, o, src); binds.push(bind); }
    }
    hc.Binds = binds;
  }
  if (hc.Mounts) {
    hc.Mounts = await Promise.all((hc.Mounts as any[]).map(async (m) => {
      const type = m.Type ?? "volume";
      if (type === "bind") {
        if (m.BindOptions?.Propagation && !["", "rprivate", "private"].includes(m.BindOptions.Propagation)) throw new Deny("Mount-Propagation ist gesperrt");
        return { ...m, Source: hostPath(o, m.Source ?? "") };
      }
      if (type === "volume") {
        const dc = m.VolumeOptions?.DriverConfig;
        if (dc && ((dc.Name && dc.Name !== "local") || (dc.Options && Object.keys(dc.Options).length))) throw new Deny("Volume-Treiber-Optionen sind gesperrt");
        if (m.Source) await volumeUsable(api, o, m.Source);
        return m;
      }
      if (type === "tmpfs") return m;
      throw new Deny(`Mount-Typ ${type} ist gesperrt`);
    }));
  }

  // Netz: Standardnetze → Job-Netz, sonst nur eigene Netze
  hc.NetworkMode = await mapNetwork(api, o, hc.NetworkMode ?? "");
  const endpoints = b.NetworkingConfig?.EndpointsConfig;
  if (endpoints) {
    const mapped: Record<string, any> = {};
    for (const [name, cfg] of Object.entries(endpoints)) mapped[await mapNetwork(api, o, name)] = cfg;
    b.NetworkingConfig = { ...b.NetworkingConfig, EndpointsConfig: mapped };
  }
  // Veröffentlichte Ports nur lokal auf dem Server, nie im LAN
  if (hc.PortBindings) {
    hc.PortBindings = Object.fromEntries(Object.entries(hc.PortBindings as Record<string, any[]>).map(([port, list]) =>
      [port, (list ?? []).map((p) => ({ ...p, HostIp: "127.0.0.1" }))]));
  }

  // Grenzen
  if (!hc.Memory || hc.Memory > memory) { hc.Memory = memory; hc.MemorySwap = memory; }
  if (!hc.MemorySwap || hc.MemorySwap < 0 || hc.MemorySwap > memory) hc.MemorySwap = hc.Memory;
  if (!hc.PidsLimit || hc.PidsLimit <= 0 || hc.PidsLimit > pids) hc.PidsLimit = pids;
  if (!hc.CpuQuota && !hc.CpuPeriod) { if (!hc.NanoCpus || hc.NanoCpus > cpus) hc.NanoCpus = cpus; }
  // Nach dem Job räumt der Runner auf. Neustart-Regeln würden Container ohne Job weiterleben lassen.
  hc.RestartPolicy = { Name: "no" };

  b.HostConfig = hc;
  b.Labels = { ...(b.Labels ?? {}), [OWNER_LABEL]: o.owner };
  return b;
}

// ---------- Filter für Listen ----------

/** Fügt den Eigentümer-Filter in ?filters= ein, damit Listen nur eigene Ressourcen zeigen. */
export function withOwnerFilter(q: URLSearchParams, owner: string): URLSearchParams {
  const out = new URLSearchParams(q);
  let f: any = {};
  try { f = JSON.parse(q.get("filters") ?? "{}") ?? {}; } catch {}
  const label = `${OWNER_LABEL}=${owner}`;
  if (Array.isArray(f.label)) f.label = [...f.label, label];
  else if (f.label && typeof f.label === "object") f.label = { ...f.label, [label]: true };
  else f.label = [label];
  out.set("filters", JSON.stringify(f));
  return out;
}

// ---------- Entscheidung pro Anfrage ----------

export type Decision =
  | { kind: "pass"; path: string }                                         // unverändert durchreichen (auch Streams)
  | {
      kind: "json"; method: string; path: string; body?: unknown;
      after?: (res: { status: number; json: any }) => Promise<void>;
      /** Antwort vor der Rückgabe anpassen */
      transform?: (json: any) => any;
    }
  | { kind: "deny"; status: number; message: string };

/** Braucht diese Anfrage ihren JSON-Body für die Prüfung? */
export function needsBody(method: string, path: string): boolean {
  if (method !== "POST") return false;
  return /^\/(containers\/create|networks\/create|volumes\/create)$/.test(path)
    || /^\/containers\/[^/]+\/exec$/.test(path)
    || /^\/networks\/[^/]+\/(connect|disconnect)$/.test(path);
}

export function splitPath(raw: string): Req {
  const u = new URL(raw, "http://docker");
  const m = u.pathname.match(/^(\/v\d+(?:\.\d+)?)(\/.*)$/);
  return { method: "", prefix: m ? m[1] : "", path: m ? m[2] : u.pathname, query: u.searchParams };
}

const withQuery = (prefix: string, path: string, q: URLSearchParams) => {
  const s = q.toString();
  return `${prefix}${path}${s ? `?${s}` : ""}`;
};

export async function decide(api: DockerApi, o: GuardOptions, r: Req, bodyBuf?: Buffer): Promise<Decision> {
  const { method, path, query, prefix } = r;
  const full = (p: string, q = query) => withQuery(prefix, p, q);
  const pass = (p = path, q = query): Decision => ({ kind: "pass", path: full(p, q) });
  let m: RegExpMatchArray | null;

  // Allgemeines, nur lesend
  if ((method === "GET" || method === "HEAD") && /^\/(_ping|version|info)$/.test(path)) return pass();
  if (method === "GET" && path === "/events") return pass(path, withOwnerFilter(query, o.owner));

  // ---- Images ----
  if (method === "GET" && path === "/images/json") return pass();
  if (method === "GET" && /^\/images\/search$/.test(path)) return pass();
  if (method === "GET" && /^\/images\/.+\/(json|history)$/.test(path)) return pass();
  if (method === "GET" && /^\/distribution\/.+\/json$/.test(path)) return pass();
  if (method === "POST" && path === "/images/create") {
    if (query.get("fromSrc")) throw new Deny("docker import ist gesperrt");
    return pass();                                                             // docker pull
  }
  if (method === "POST" && (m = path.match(/^\/images\/(.+)\/tag$/))) {
    await ownedImage(api, o, m[1]);
    const repo = query.get("repo") ?? "", tag = query.get("tag") || "latest";
    await tagUsable(api, o, `${repo}:${tag}`);
    return pass();
  }
  if (method === "DELETE" && (m = path.match(/^\/images\/(.+)$/))) { await ownedImage(api, o, m[1]); return pass(); }

  // ---- Build (nur klassischer Builder) ----
  if (method === "POST" && path === "/build") {
    const nm = query.get("networkmode") ?? "";
    if (!["", "default", "bridge", "none"].includes(nm)) throw new Deny(`docker build --network ${nm} ist gesperrt`);
    if (query.get("cgroupparent")) throw new Deny("cgroupparent ist gesperrt");
    if (query.get("version") === "2") throw new Deny("BuildKit ist gesperrt. Setze DOCKER_BUILDKIT=0 (im Job-Image Standard).");
    for (const t of query.getAll("t")) await tagUsable(api, o, withTag(t));
    let labels: Record<string, string> = {};
    try { labels = JSON.parse(query.get("labels") ?? "{}") ?? {}; } catch {}
    const q = new URLSearchParams(query);
    q.set("labels", JSON.stringify({ ...labels, [OWNER_LABEL]: o.owner }));
    q.set("rm", "1"); q.set("forcerm", "1");
    return pass(path, q);
  }
  if (method === "POST" && path === "/build/cancel") return pass();
  if (path === "/grpc" || path === "/session") throw new Deny("BuildKit ist gesperrt. Setze DOCKER_BUILDKIT=0 (im Job-Image Standard).");

  // ---- Container ----
  if (method === "GET" && path === "/containers/json") return pass(path, withOwnerFilter(query, o.owner));
  if (method === "POST" && path === "/containers/create") {
    const max = o.maxContainers ?? 12;
    const list = await api.get(withQuery("", "/containers/json", withOwnerFilter(new URLSearchParams({ all: "1" }), o.owner)));
    if (Array.isArray(list.json) && list.json.length >= max) throw new Deny(`Höchstens ${max} Container pro Job. Räum nicht mehr gebrauchte Container weg.`);
    return { kind: "json", method, path: full(path), body: await checkContainerCreate(api, o, json(bodyBuf)) };
  }
  if ((m = path.match(/^\/containers\/([^/]+)(\/.*)?$/)) && !["json", "create", "prune"].includes(m[1])) {
    const info = await ownedContainer(api, o, decodeURIComponent(m[1]));
    const rest = m[2] ?? "";
    const p = `/containers/${info.Id}${rest}`;
    if (method === "POST" && rest === "/exec") {
      const body = json(bodyBuf);
      if (body.Privileged) throw new Deny("docker exec --privileged ist gesperrt");
      return { kind: "json", method, path: full(p), body };
    }
    if (rest === "/update" && method === "POST") throw new Deny("docker update ist gesperrt");
    return pass(p);
  }
  if ((m = path.match(/^\/exec\/([^/]+)\/(start|resize|json)$/))) {
    const r2 = await api.get(`/exec/${encodeURIComponent(m[1])}/json`);
    if (r2.status !== 200) throw new Deny(`Exec ${m[1]} nicht gefunden`, 404);
    await ownedContainer(api, o, r2.json.ContainerID);
    return pass();
  }

  // ---- Netze ----
  if (method === "GET" && path === "/networks") return pass(path, withOwnerFilter(query, o.owner));
  if (method === "POST" && path === "/networks/create") {
    const b = json(bodyBuf);
    if (b.Driver && b.Driver !== "bridge") throw new Deny(`Netz-Treiber ${b.Driver} ist gesperrt`);
    if (b.Ingress || b.ConfigFrom || b.ConfigOnly || b.Scope === "swarm") throw new Deny("Swarm-Netze sind gesperrt");
    if (b.Options && Object.keys(b.Options).length) throw new Deny("Netz-Optionen sind gesperrt");
    if ((b.IPAM?.Config ?? []).length || (b.IPAM?.Driver && b.IPAM.Driver !== "default")) {
      throw new Deny("Eigene Subnetze sind gesperrt (sie könnten mit dem LAN kollidieren). Docker wählt das Subnetz selbst.");
    }
    const body = { ...b, Labels: { ...(b.Labels ?? {}), [OWNER_LABEL]: o.owner } };
    return {
      kind: "json", method, path: full(path), body,
      // Den Job-Container ins neue Netz hängen, damit der Agent die Dienste darin per Name erreicht
      after: async (res) => {
        if (res.status === 201 && res.json?.Id) await api.send("POST", `/networks/${res.json.Id}/connect`, { Container: o.owner });
      },
    };
  }
  if ((m = path.match(/^\/networks\/([^/]+)\/(connect|disconnect)$/)) && method === "POST") {
    const net = await ownedNetwork(api, o, decodeURIComponent(m[1]));
    const b = json(bodyBuf);
    const target = String(b.Container ?? "");
    if (target !== o.owner) {
      const c = await ownedContainer(api, o, target);
      b.Container = c.Id;
    }
    return { kind: "json", method, path: full(`/networks/${net.Id}/${m[2]}`), body: b };
  }
  if ((m = path.match(/^\/networks\/([^/]+)$/)) && path !== "/networks/prune") {
    const net = await ownedNetwork(api, o, decodeURIComponent(m[1]));
    if (method === "GET") {
      // Der Job-Container hängt in jedem eigenen Netz. Compose würde das Netz sonst beim "down" nicht entfernen.
      return {
        kind: "json", method, path: full(`/networks/${net.Id}`),
        transform: (j) => ({ ...j, Containers: Object.fromEntries(Object.entries(j?.Containers ?? {}).filter(([, c]: [string, any]) => c?.Name !== o.owner)) }),
      };
    }
    if (method === "DELETE") {
      if (net.Name === o.network) throw new Deny("Das Job-Netz kann nicht gelöscht werden");
      await api.send("POST", `/networks/${net.Id}/disconnect`, { Container: o.owner, Force: true });
      return pass(`/networks/${net.Id}`);
    }
  }

  // ---- Volumes ----
  if (method === "GET" && path === "/volumes") return pass(path, withOwnerFilter(query, o.owner));
  if (method === "POST" && path === "/volumes/create") {
    const b = json(bodyBuf);
    if (b.Driver && b.Driver !== "local") throw new Deny(`Volume-Treiber ${b.Driver} ist gesperrt`);
    if (b.DriverOpts && Object.keys(b.DriverOpts).length) throw new Deny("Volume-Optionen sind gesperrt (damit ließen sich Server-Pfade einbinden)");
    if (b.ClusterVolumeSpec) throw new Deny("Cluster-Volumes sind gesperrt");
    if (b.Name) {
      const existing = await api.get(`/volumes/${encodeURIComponent(b.Name)}`);
      if (existing.status === 200 && !ownedBy(existing.json, o.owner)) throw new Deny(`Volume ${b.Name} gehört nicht zu diesem Job`);
    }
    return { kind: "json", method, path: full(path), body: { ...b, Labels: { ...(b.Labels ?? {}), [OWNER_LABEL]: o.owner } } };
  }
  if ((m = path.match(/^\/volumes\/([^/]+)$/)) && path !== "/volumes/prune" && (method === "GET" || method === "DELETE")) {
    await ownedVolume(api, o, decodeURIComponent(m[1]));
    return pass();
  }

  throw new Deny(`${method} ${path} ist für Factory-Jobs gesperrt`);
}

// ---------- HTTP über Unix-Sockets ----------

export function upstreamApi(socketPath: string): DockerApi {
  const call = (method: string, path: string, body?: unknown) => new Promise<{ status: number; json: any; raw: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({
      socketPath, method, path,
      headers: { Host: "docker", ...(data ? { "Content-Type": "application/json", "Content-Length": String(data.length) } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let j: any = null;
        try { j = raw ? JSON.parse(raw) : null; } catch {}
        resolve({ status: res.statusCode ?? 500, json: j, raw });
      });
    });
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("Zeitlimit Docker-API")));
    if (data) req.write(data);
    req.end();
  });
  return { get: (p) => call("GET", p), send: call };
}

type Head = { method: string; target: string; version: string; headers: [string, string][] };

function parseHead(buf: Buffer): Head {
  const lines = buf.toString("latin1").split("\r\n");
  const [method, target, version] = lines[0].split(" ");
  const headers = lines.slice(1).filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
  });
  return { method, target, version: version ?? "HTTP/1.1", headers };
}
const header = (h: Head, name: string) => h.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

function respond(sock: Socket, status: number, body: unknown) {
  const data = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const reason = ({ 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" } as Record<number, string>)[status] ?? "Status";
  sock.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n` + data.toString("latin1"), "latin1");
}

/** Liest einen Request-Body (Content-Length oder chunked) vollständig, höchstens maxBytes. */
function readBody(sock: Socket, head: Head, initial: Buffer, maxBytes = 2 * MB): Promise<Buffer> {
  const len = header(head, "content-length");
  const chunked = /chunked/i.test(header(head, "transfer-encoding") ?? "");
  return new Promise((resolve, reject) => {
    let buf = initial;
    const done = () => {
      if (len !== undefined) {
        if (buf.length >= Number(len)) return resolve(buf.subarray(0, Number(len))), true;
        return false;
      }
      if (!chunked) return resolve(Buffer.alloc(0)), true;
      // chunked dekodieren, sobald das Ende-Chunk da ist
      const out: Buffer[] = [];
      let i = 0;
      while (true) {
        const nl = buf.indexOf("\r\n", i);
        if (nl < 0) return false;
        const size = parseInt(buf.subarray(i, nl).toString("latin1").split(";")[0], 16);
        if (Number.isNaN(size)) return reject(new Deny("Ungültiger Body", 400)), true;
        if (size === 0) return resolve(Buffer.concat(out)), true;
        if (buf.length < nl + 2 + size + 2) return false;
        out.push(buf.subarray(nl + 2, nl + 2 + size));
        i = nl + 2 + size + 2;
      }
    };
    if (done()) return;
    const onData = (c: Buffer) => {
      buf = Buffer.concat([buf, c]);
      if (buf.length > maxBytes) { sock.off("data", onData); reject(new Deny("Body zu groß", 400)); return; }
      if (done()) sock.off("data", onData);
    };
    sock.on("data", onData);
    sock.once("end", () => reject(new Error("Verbindung beendet")));
  });
}

function serializeHead(h: Head, target: string, overrides: Record<string, string | null>): string {
  const lower = new Map(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  const lines = [`${h.method} ${target} ${h.version}`];
  for (const [k, v] of h.headers) if (!lower.has(k.toLowerCase())) lines.push(`${k}: ${v}`);
  for (const [k, v] of lower.values()) if (v !== null) lines.push(`${k}: ${v}`);
  return lines.join("\r\n") + "\r\n\r\n";
}

export type GuardLog = (event: string, data: Record<string, unknown>) => void;

function handle(client: Socket, o: GuardOptions, api: DockerApi, log: GuardLog) {
  const upstreamPath = o.upstream ?? "/var/run/docker.sock";
  let buf = Buffer.alloc(0);
  const onData = async (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf("\r\n\r\n");
    if (end < 0) { if (buf.length > 64 * KB) client.destroy(); return; }
    client.off("data", onData);
    client.pause();
    const head = parseHead(buf.subarray(0, end));
    let rest = buf.subarray(end + 4);
    const r = { ...splitPath(head.target), method: head.method };
    try {
      let body: Buffer | undefined;
      if (needsBody(r.method, r.path)) { client.resume(); body = await readBody(client, head, rest); client.pause(); rest = Buffer.alloc(0); }
      const d = await decide(api, o, r, body);
      if (d.kind === "json") {
        const res = await api.send(d.method, d.path, d.body);
        if (d.after) await d.after(res).catch((e) => log("guard:after-error", { owner: o.owner, error: String(e) }));
        respond(client, res.status, d.transform && res.status === 200 ? d.transform(res.json) : res.raw || "");
        return;
      }
      if (d.kind === "deny") throw new Deny(d.message, d.status);
      // Durchreichen: Kopf mit geprüftem Pfad, danach roh in beide Richtungen (Streams, attach, exec)
      const upgrade = !!header(head, "upgrade");
      const up = connect({ path: upstreamPath, allowHalfOpen: true });
      up.on("error", () => client.destroy());
      client.on("error", () => up.destroy());
      up.write(serializeHead(head, d.path, upgrade ? {} : { Connection: "close" }), "latin1");
      if (rest.length) up.write(rest);
      client.pipe(up);
      up.pipe(client);
      client.resume();
    } catch (e) {
      const status = e instanceof Deny ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status === 403) log("guard:denied", { owner: o.owner, method: r.method, path: r.path, reason: message });
      respond(client, status, { message: `Software Factory: ${message}` });
    }
  };
  client.on("data", onData);
  client.on("error", () => {});
}

/**
 * Prüft, ob die Laufzeit halboffene Verbindungen kann: Die Docker-CLI schließt bei exec/attach ihre
 * Schreibseite, die Ausgabe muss danach noch zurückkommen. Bun kann das erst in neueren Versionen
 * (1.2/1.3 nein, 1.4.5 ja), Node immer.
 */
export function halfOpenSupported(dir: string): Promise<boolean> {
  const path = `${dir}/selftest-${process.pid}.sock`;
  mkdirSync(dir, { recursive: true });
  rmSync(path, { force: true });
  return new Promise((resolve) => {
    const server = createServer({ allowHalfOpen: true }, (c) => {
      c.on("data", () => {});
      c.on("end", () => setTimeout(() => { c.write("ok"); c.end(); }, 20));
    });
    const done = (ok: boolean) => { clearTimeout(timer); server.close(); rmSync(path, { force: true }); resolve(ok); };
    const timer = setTimeout(() => done(false), 3000);
    server.listen(path, () => {
      const cl = connect({ path, allowHalfOpen: true });
      let got = "";
      cl.on("data", (d) => (got += d));
      cl.on("error", () => done(false));
      cl.on("close", () => done(got === "ok"));
      cl.on("connect", () => cl.end("x"));
    });
  });
}

/** Startet den Wächter auf einem Unix-Socket. Der Socket ist für den Container-Nutzer beschreibbar. */
export function startGuard(socketPath: string, o: GuardOptions, log: GuardLog = () => {}): Promise<Server> {
  const api = upstreamApi(o.upstream ?? "/var/run/docker.sock");
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });
  // allowHalfOpen: Die Docker-CLI schließt bei attach/exec ihre Schreibseite, die Ausgabe muss trotzdem zurückkommen
  const server = createServer({ allowHalfOpen: true }, (c) => handle(c, o, api, log));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      chmodSync(socketPath, 0o666);
      resolve(server);
    });
  });
}
