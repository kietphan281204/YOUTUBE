function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing env ${name}. Create a .env or set it in terminal.`);
  }
  return v;
}

function splitNamedInstance(serverValue) {
  // Accept forms like:
  // - DESKTOP-XXX\SQLEXPRESS
  // - localhost\SQLEXPRESS
  // - 127.0.0.1\SQLEXPRESS
  const idx = serverValue.indexOf("\\");
  if (idx === -1) return { server: serverValue, instanceName: undefined };
  return { server: serverValue.slice(0, idx), instanceName: serverValue.slice(idx + 1) || undefined };
}

// SQL Server config for `mssql` package
// Defaults are aligned with your VSCode mssql connection (SQLEXPRESS + sa).
const serverRaw = required("DB_SERVER", "127.0.0.1");
const { server, instanceName } = splitNamedInstance(serverRaw);
const portRaw = process.env.DB_PORT;
const port = portRaw ? Number(portRaw) : undefined;

const sqlConfig = {
  user: required("DB_USER", "sa"),
  // Password can be empty on some local setups; set DB_PASSWORD if needed.
  password: process.env.DB_PASSWORD ?? "",
  server,
  database: required("DB_DATABASE", "master"),
  ...(Number.isFinite(port) ? { port } : null),
  connectionTimeout: 30000,
  requestTimeout: 30000,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    ...(Number.isFinite(port) ? null : instanceName ? { instanceName } : null),
  },
};

module.exports = { sqlConfig };

