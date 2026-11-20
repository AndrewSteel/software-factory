// Regeln des Docker-Wächters, ohne echtes Docker (die Docker-API wird nachgebildet).
// Ausführen: node --test runner/docker-guard.test.ts   (Node 22.6+)

import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, Deny, hostPath, parseBytes, splitPath, withOwnerFilter, withTag, type DockerApi, type GuardOptions } from "./docker-guard.ts";

const o: GuardOptions = { owner: "sf-job-1", network: "sf-job-1-net", hostWorkDir: "/var/lib/software-factory/jobs/x__1", memoryBytes: 1024 ** 3, maxContainers: 3 };
const mine = { [`sf.owner`]: "sf-job-1" };

/** Nachgebildetes Docker: eigene und fremde (produktive) Ressourcen */
function fakeApi(): DockerApi & { sent: any[] } {
  const containers: Record<string, any> = {
    pg: { Id: "c-pg-full", Config: { Labels: mine } },
    postgres: { Id: "c-prod", Config: { Labels: {} } },
    "sf-job-1": { Id: "c-job", Config: { Labels: { "software-factory": "1" } } },
  };
  const networks: Record<string, any> = {
    "sf-job-1-net": { Id: "n-job", Name: "sf-job-1-net", Labels: mine },
    mynet: { Id: "n-mine", Name: "mynet", Labels: mine },
    backend: { Id: "n-prod", Name: "backend", Labels: {} },
  };
  const volumes: Record<string, any> = { data: { Labels: mine }, "postgres-data": { Labels: {} } };
  const images: Record<string, any> = { "postgres:16": { Config: { Labels: {} } }, "sf-test-app:latest": { Config: { Labels: mine } } };
  const sent: any[] = [];
  const get = async (path: string) => {
    let m;
    if ((m = path.match(/^\/containers\/json/))) return { status: 200, json: [{ Id: "c-pg-full" }] };
    if ((m = path.match(/^\/containers\/([^/]+)\/json$/))) { const c = containers[decodeURIComponent(m[1])]; return c ? { status: 200, json: c } : { status: 404, json: null }; }
    if ((m = path.match(/^\/networks\/([^/]+)$/))) { const n = networks[decodeURIComponent(m[1])]; return n ? { status: 200, json: n } : { status: 404, json: null }; }
    if ((m = path.match(/^\/volumes\/([^/]+)$/))) { const v = volumes[decodeURIComponent(m[1])]; return v ? { status: 200, json: v } : { status: 404, json: null }; }
    if ((m = path.match(/^\/images\/(.+)\/json$/))) { const i = images[m[1]]; return i ? { status: 200, json: i } : { status: 404, json: null }; }
    if ((m = path.match(/^\/exec\/([^/]+)\/json$/))) return { status: 200, json: { ContainerID: m[1] === "e-mine" ? "pg" : "postgres" } };
    return { status: 404, json: null };
  };
  return { get, sent, send: async (method, path, body) => { sent.push({ method, path, body }); return { status: 201, json: {}, raw: "{}" }; } };
}

const req = (method: string, target: string) => ({ ...splitPath(target), method });
const body = (b: unknown) => Buffer.from(JSON.stringify(b));
const create = (hc: any, extra: any = {}) => decide(fakeApi(), o, req("POST", "/v1.47/containers/create?name=x"), body({ Image: "postgres:16", HostConfig: hc, ...extra }));
const denied = async (p: Promise<unknown>, re: RegExp) => { await assert.rejects(p, (e: any) => e instanceof Deny && re.test(e.message)); };

test("Hilfsfunktionen: Größen, Tags, Pfade, Filter", () => {
  assert.equal(parseBytes("4g", 0), 4 * 1024 ** 3);
  assert.equal(parseBytes("512m", 0), 512 * 1024 ** 2);
  assert.equal(parseBytes("quatsch", 7), 7);
  assert.equal(withTag("sf-app"), "sf-app:latest");
  assert.equal(withTag("registry:5000/app"), "registry:5000/app:latest");
  assert.equal(withTag("app:1"), "app:1");
  assert.equal(hostPath(o, "/work/repo/sql"), "/var/lib/software-factory/jobs/x__1/repo/sql");
  assert.throws(() => hostPath(o, "/work/../etc"), Deny);
  assert.throws(() => hostPath(o, "/srv/compose/automations/n8n/.env"), Deny);
  assert.throws(() => hostPath(o, "/workspace"), Deny);
  const f = JSON.parse(withOwnerFilter(new URLSearchParams({ filters: '{"label":{"a=b":true}}' }), "sf-job-1").get("filters")!);
  assert.deepEqual(f.label, { "a=b": true, "sf.owner=sf-job-1": true });
});

test("Container: Standardnetz wird zum Job-Netz, Grenzen und Label werden gesetzt", async () => {
  const d: any = await create({ NetworkMode: "default", PortBindings: { "5432/tcp": [{ HostIp: "", HostPort: "5432" }] }, RestartPolicy: { Name: "always" } });
  assert.equal(d.kind, "json");
  assert.equal(d.body.HostConfig.NetworkMode, "sf-job-1-net");
  assert.equal(d.body.HostConfig.Memory, 1024 ** 3);
  assert.equal(d.body.HostConfig.PidsLimit, 1024);
  assert.equal(d.body.HostConfig.RestartPolicy.Name, "no");
  assert.equal(d.body.HostConfig.PortBindings["5432/tcp"][0].HostIp, "127.0.0.1");
  assert.equal(d.body.Labels["sf.owner"], "sf-job-1");
  assert.equal(d.path, "/v1.47/containers/create?name=x");
});

test("Container: Bind-Mounts nur aus /work, übersetzt auf den Job-Ordner", async () => {
  const d: any = await create({ Binds: ["/work/repo/sql/init-schema.sql:/docker-entrypoint-initdb.d/init.sql:ro", "data:/var/lib/postgresql/data"] });
  assert.deepEqual(d.body.HostConfig.Binds, ["/var/lib/software-factory/jobs/x__1/repo/sql/init-schema.sql:/docker-entrypoint-initdb.d/init.sql:ro", "data:/var/lib/postgresql/data"]);
  await denied(create({ Binds: ["/srv/warm/postgres:/var/lib/postgresql/data"] }), /Bind-Mount/);
  await denied(create({ Binds: ["/var/run/docker.sock:/var/run/docker.sock"] }), /Bind-Mount/);
  await denied(create({ Mounts: [{ Type: "bind", Source: "/etc", Target: "/x" }] }), /Bind-Mount/);
  await denied(create({ Binds: ["postgres-data:/d"] }), /gehört nicht/);
  await denied(create({ Mounts: [{ Type: "volume", Source: "v", Target: "/x", VolumeOptions: { DriverConfig: { Name: "local", Options: { type: "none", o: "bind", device: "/srv" } } } }] }), /Treiber/);
});

test("Container: alles, was den Server oder produktive Dienste erreicht, ist gesperrt", async () => {
  await denied(create({ Privileged: true }), /privileged/);
  await denied(create({ CapAdd: ["SYS_ADMIN"] }), /Capabilities/);
  await denied(create({ DeviceRequests: [{ Driver: "nvidia", Count: -1 }] }), /GPU/);
  await denied(create({ Runtime: "nvidia" }), /Runtime/);
  await denied(create({ NetworkMode: "host" }), /host/);
  await denied(create({ NetworkMode: "backend" }), /Produktive Netze/);
  await denied(create({ PidMode: "host" }), /pid=host/);
  await denied(create({ PidMode: "container:postgres" }), /gehört nicht/);
  await denied(create({ IpcMode: "host" }), /ipc=host/);
  await denied(create({ UsernsMode: "host" }), /userns/);
  await denied(create({ SecurityOpt: ["apparmor=unconfined"] }), /security-opt/);
  await denied(create({ MaskedPaths: [] }), /MaskedPaths/);
  await denied(create({ VolumesFrom: ["postgres"] }), /gehört nicht/);
  await denied(create({ OomScoreAdj: -500 }), /OOM/);
  await denied(create({ CgroupParent: "/" }), /Cgroup/);
  await denied(create({ LogConfig: { Type: "syslog" } }), /Log-Treiber/);
  await denied(create({}, { NetworkingConfig: { EndpointsConfig: { backend: {} } } }), /Produktive Netze/);
});

test("Container-Zugriffe nur auf eigene Container, mit voller ID", async () => {
  const api = fakeApi();
  const d: any = await decide(api, o, req("POST", "/v1.47/containers/pg/start"));
  assert.deepEqual(d, { kind: "pass", path: "/v1.47/containers/c-pg-full/start" });
  await denied(decide(api, o, req("POST", "/v1.47/containers/postgres/stop")), /gehört nicht/);
  await denied(decide(api, o, req("DELETE", "/v1.47/containers/postgres")), /gehört nicht/);
  await denied(decide(api, o, req("GET", "/v1.47/containers/sf-job-1/json")), /gehört nicht/);
  await denied(decide(api, o, req("POST", "/v1.47/containers/pg/exec"), body({ Cmd: ["sh"], Privileged: true })), /privileged/);
  assert.equal((await decide(api, o, req("POST", "/v1.47/exec/e-mine/start"))).kind, "pass");
  await denied(decide(api, o, req("POST", "/v1.47/exec/e-prod/start")), /gehört nicht/);
  const list: any = await decide(api, o, req("GET", "/v1.47/containers/json?all=1"));
  assert.match(decodeURIComponent(list.path), /sf\.owner=sf-job-1/);
});

test("Höchstzahl Container pro Job", async () => {
  const strict = { ...o, maxContainers: 1 };
  await denied(decide(fakeApi(), strict, req("POST", "/containers/create"), body({ Image: "x" })), /Höchstens 1/);
});

test("Builds: nur klassischer Builder, keine fremden Tags, Label wird gesetzt", async () => {
  const api = fakeApi();
  const d: any = await decide(api, o, req("POST", "/v1.47/build?t=sf-test-app&dockerfile=Dockerfile"));
  const q = new URL(d.path, "http://d").searchParams;
  assert.deepEqual(JSON.parse(q.get("labels")!), { "sf.owner": "sf-job-1" });
  await denied(decide(api, o, req("POST", "/v1.47/build?t=postgres:16")), /gehört schon/);
  await denied(decide(api, o, req("POST", "/v1.47/build?t=sf-x&networkmode=host")), /network/);
  await denied(decide(api, o, req("POST", "/v1.47/build?version=2&t=sf-x")), /BuildKit/);
  await denied(decide(api, o, req("POST", "/grpc")), /BuildKit/);
  await denied(decide(api, o, req("POST", "/session")), /BuildKit/);
  assert.equal((await decide(api, o, req("POST", "/v1.47/images/create?fromImage=redis&tag=7-alpine"))).kind, "pass");
  await denied(decide(api, o, req("DELETE", "/v1.47/images/postgres:16")), /nicht von diesem Job/);
  assert.equal((await decide(api, o, req("DELETE", "/v1.47/images/sf-test-app:latest"))).kind, "pass");
  await denied(decide(api, o, req("POST", "/v1.47/images/sf-test-app:latest/tag?repo=postgres&tag=16")), /gehört schon/);
});

test("Netze und Volumes: eigene ja, fremde und gefährliche Optionen nein", async () => {
  const api = fakeApi();
  const n: any = await decide(api, o, req("POST", "/v1.47/networks/create"), body({ Name: "sf-test_default", Driver: "bridge" }));
  assert.equal(n.body.Labels["sf.owner"], "sf-job-1");
  await n.after({ status: 201, json: { Id: "n-new" } });
  assert.deepEqual(api.sent.at(-1), { method: "POST", path: "/networks/n-new/connect", body: { Container: "sf-job-1" } });
  await denied(decide(api, o, req("POST", "/networks/create"), body({ Name: "x", Driver: "macvlan" })), /Treiber/);
  await denied(decide(api, o, req("POST", "/networks/create"), body({ Name: "x", IPAM: { Config: [{ Subnet: "192.168.178.0/24" }] } })), /Subnetze/);
  await denied(decide(api, o, req("POST", "/networks/backend/connect"), body({ Container: "pg" })), /Produktive Netze/);
  await denied(decide(api, o, req("POST", "/networks/mynet/connect"), body({ Container: "postgres" })), /gehört nicht/);
  await denied(decide(api, o, req("DELETE", "/networks/backend")), /Produktive Netze/);
  await denied(decide(api, o, req("DELETE", "/networks/sf-job-1-net")), /Job-Netz/);
  const g: any = await decide(api, o, req("GET", "/networks/mynet"));
  assert.deepEqual(g.transform({ Containers: { a: { Name: "sf-job-1" }, b: { Name: "pg" } } }).Containers, { b: { Name: "pg" } });
  const v: any = await decide(api, o, req("POST", "/volumes/create"), body({ Name: "neu" }));
  assert.equal(v.body.Labels["sf.owner"], "sf-job-1");
  await denied(decide(api, o, req("POST", "/volumes/create"), body({ Name: "x", DriverOpts: { device: "/srv" } })), /Optionen/);
  await denied(decide(api, o, req("POST", "/volumes/create"), body({ Name: "postgres-data" })), /gehört nicht/);
  await denied(decide(api, o, req("DELETE", "/volumes/postgres-data")), /gehört nicht/);
});

test("Alles andere ist gesperrt", async () => {
  const api = fakeApi();
  for (const [m, p] of [["POST", "/containers/prune"], ["POST", "/volumes/prune"], ["POST", "/images/prune"], ["POST", "/networks/prune"],
    ["POST", "/build/prune"], ["POST", "/images/load"], ["POST", "/commit?container=pg"], ["GET", "/swarm"], ["POST", "/plugins/pull"],
    ["POST", "/auth"], ["GET", "/system/df"], ["POST", "/containers/pg/update"]] as const) {
    await denied(decide(api, o, req(m, `/v1.47${p}`)), /gesperrt/);
  }
});
