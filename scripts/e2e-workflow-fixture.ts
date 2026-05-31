import { createServer as createHttpServer, type Server } from "node:http";

export async function startWorkflowFixtureServer(): Promise<{
  readonly server: Server;
  readonly url: string;
}> {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/download.txt") {
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="download.txt"',
      });
      response.end("firefox-cli download fixture\n");
      return;
    }
    if (url.pathname === "/api/ping") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Child frame</title><p>Frame fixture</p>");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>firefox-cli disposable E2E</title>
          <style>
            #feed { height: 80px; overflow: auto; border: 1px solid #999; }
            #feed-inner { height: 400px; padding-top: 260px; }
            #drop-target, #mouse-target { min-height: 24px; border: 1px solid #999; margin: 8px 0; }
          </style>
        </head>
        <body>
          <main>
            <h1>Disposable Firefox E2E</h1>
            <label>Email <input id="email" type="email" autocomplete="off"></label>
            <label>Name <input id="name" autocomplete="off"></label>
            <label>Notes <textarea id="notes"></textarea></label>
            <label><input id="agree" type="checkbox"> Accept terms</label>
            <label>Plan
              <select id="plan">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="team">Team</option>
              </select>
            </label>
            <button id="submit" type="button">Submit E2E</button>
            <div id="status" role="status">Idle</div>
            <button id="drag-source" type="button">Drag source</button>
            <div id="drop-target" data-testid="drop-zone">Drop target</div>
            <label>Upload <input id="upload" type="file"></label>
            <div id="upload-status">No upload</div>
            <input id="key-target" aria-label="Key target">
            <div id="mouse-target">Mouse target</div>
            <input id="clipboard-target" value="copy-source">
            <button id="highlight-target" type="button" data-testid="highlight-target">Highlight target</button>
            <iframe title="Child frame" src="/frame"></iframe>
            <div id="feed" role="region" aria-label="Activity feed">
              <div id="feed-inner"><button id="feed-bottom">Feed bottom</button></div>
            </div>
          </main>
          <script>
            const submit = () => {
              document.body.dataset.submits = String(Number(document.body.dataset.submits || "0") + 1);
              document.querySelector("#status").textContent = [
                "Submitted",
                document.querySelector("#email").value,
                document.querySelector("#name").value,
                document.querySelector("#notes").value,
                document.querySelector("#agree").checked ? "agreed" : "not-agreed",
                document.querySelector("#plan").value
              ].join(" ");
            };
            document.querySelector("#submit").addEventListener("click", submit);
            document.querySelector("#drop-target").addEventListener("drop", (event) => {
              event.preventDefault();
              document.body.dataset.dropped = "true";
            });
            document.querySelector("#drop-target").addEventListener("dragover", (event) => event.preventDefault());
            document.querySelector("#upload").addEventListener("change", (event) => {
              document.querySelector("#upload-status").textContent = event.target.files[0]?.name || "missing";
            });
            document.querySelector("#mouse-target").addEventListener("mousedown", () => {
              document.body.dataset.mouseDown = "true";
            });
            document.querySelector("#mouse-target").addEventListener("wheel", () => {
              document.body.dataset.mouseWheel = "true";
            });
            document.querySelector("#key-target").addEventListener("keydown", (event) => {
              document.body.dataset.keyDown = event.key;
            });
            document.querySelector("#key-target").addEventListener("keyup", (event) => {
              document.body.dataset.keyUp = event.key;
            });
          </script>
        </body>
      </html>`);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port.");
  }

  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}/`,
  };
}
