import http from "node:http";
import { canAccess, ROLES } from "./rbac.js";

const PORT = Number(process.env.PORT ?? 3456);

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/health") {
    res.end(JSON.stringify({ ok: true, roles: ROLES }));
    return;
  }
  if (req.url?.startsWith("/rbac/")) {
    const parts = req.url.split("/");
    const role = decodeURIComponent(parts[2] ?? "");
    const perm = decodeURIComponent(parts[3] ?? "");
    res.end(JSON.stringify({ role, permission: perm, allowed: canAccess(role, perm) }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log("CODE_EXECUTION_SUCCESS=true");
  console.log(`school_management listening port=${PORT}`);
  console.log("roles=" + ROLES.join(","));
});
