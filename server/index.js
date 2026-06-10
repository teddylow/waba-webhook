/*
Copyright (c) 2017, ZOHO CORPORATION
License: MIT
*/
const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");
const bodyParser = require("body-parser");
const errorHandler = require("errorhandler");
const morgan = require("morgan");
const serveIndex = require("serve-index");
const chalk = require("chalk");
const cors = require("cors");
const { JSDOM } = require("jsdom");
const { createBackendRouter } = require("../appsail-nodejs/backend.cjs");

process.env.PWD = process.env.PWD || process.cwd();

loadEnvFile(path.join(process.env.PWD, ".env"));

const manifestPath = path.join(process.env.PWD, "plugin-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const port = Number(process.env.PORT || 3000);
const fileLocation = manifest.file_location || "/app/app_file.html";

const app = express();

app.set("port", port);
app.use(morgan("dev"));
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(errorHandler());

app.use(
  createBackendRouter({
    storagePath: path.join(process.env.PWD, "data", "messages.json"),
    graphApiVersion: process.env.WA_GRAPH_API_VERSION || "v23.0",
  })
);

app.get(fileLocation, (req, res, next) => {
  const filepath = path.join(process.env.PWD, fileLocation);

  fs.readFile(filepath, "utf8", (err, data) => {
    if (err) {
      next(err);
      return;
    }

    const dom = new JSDOM(data);
    const doc = dom.window.document;
    const existingConfig = doc.getElementById("waba_runtime_config");
    if (existingConfig) {
      existingConfig.remove();
    }

    const runtimeConfig = {
      backendUrl: process.env.WABA_BACKEND_URL || "https://waba-10123192285.development.catalystappsail.com",
    };

    const script = doc.createElement("script");
    script.id = "waba_runtime_config";
    script.textContent = `window.WABA_CONFIG = ${JSON.stringify(runtimeConfig)};`;
    doc.head.appendChild(script);

    if (
      manifest &&
      manifest.client &&
      manifest.client.id &&
      manifest.client.scope &&
      manifest.client["accounts-url"]
    ) {
      const existingScope = doc.getElementById("zes_client_scope");
      if (existingScope) {
        existingScope.remove();
      }

      const scopeScript = doc.createElement("script");
      scopeScript.id = "zes_client_scope";
      scopeScript.setAttribute("data-clientid", manifest.client.id);
      scopeScript.setAttribute("data-scope", manifest.client.scope);
      scopeScript.setAttribute("data-accounts-url", manifest.client["accounts-url"]);
      doc.head.appendChild(scopeScript);
    }

    res.send(dom.window.document.querySelector("html").outerHTML.toString());
  });
});

app.get("/plugin-manifest.json", (req, res) => {
  res.sendFile(manifestPath);
});

app.use("/app", express.static(path.join(process.env.PWD, "app")));
app.use("/app", serveIndex(path.join(process.env.PWD, "app")));

app.get("/", (req, res) => {
  res.redirect("/app");
});

const options = {
  key: fs.readFileSync(path.join(process.env.PWD, "key.pem")),
  cert: fs.readFileSync(path.join(process.env.PWD, "cert.pem")),
};

https
  .createServer(options, app)
  .listen(port, () => {
    console.log(chalk.green(`Zet running at https://127.0.0.1:${port}`));
    console.log(
      chalk.bold.cyan(
        `Note: Open https://127.0.0.1:${port} in a browser, then approve the local certificate if prompted.`
      )
    );
  })
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(chalk.bold.red(`${port} port is already in use`));
      return;
    }

    console.error(err);
  });

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
