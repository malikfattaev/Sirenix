# Deploying to Railway

Sirenix is one always-on Node process. It keeps a websocket open to the
Capital.com tick feed, caches candles in memory, and owns a SQLite file — so it
is deployed as a single container with a volume, never as serverless functions
and never as more than one replica.

The repository already carries everything the platform needs:

| File | What it does |
| --- | --- |
| `Dockerfile` | Builds the image. Native SQLite binding included, dev tooling left behind. |
| `railway.json` | Tells Railway to use the Dockerfile, and how to health-check and restart the service. |
| `.dockerignore` | Keeps local state, secrets and `node_modules` out of the build context. |

## 1. Create the service

From the project directory, with the repository already pushed to GitHub:

```bash
railway login
railway init
railway link
```

Then connect the GitHub repository in the service's **Settings → Source**, so a
push to `master` deploys. That link needs Railway's GitHub app to have access to
the repository; without it `railway add --repo` answers `Unauthorized` and the
working tree is deployed directly instead:

```bash
railway up
```

## 2. Attach a volume

Signal history, accounts and the settings the app writes back live in SQLite.
Without a volume every redeploy starts from an empty database and the first
administrator is created again from the environment.

In the service, **Settings → Volumes → Add volume**, with the mount path:

```
/data
```

The image already points `DATABASE_PATH` and `SETTINGS_PATH` at that directory,
so nothing else has to be configured. `railway.json` declares `/data` as a
`requiredMountPath`, so a deployment without the volume is refused rather than
quietly started on an empty database.

A volume can only be attached to one container at a time, which is why
`numReplicas` is pinned to 1 and `overlapSeconds` to 0: the old container must
release the volume before the new one claims it. `sleepApplication` is off for
the same reason the service is not serverless — a process paused between
requests loses its tick socket.

## 3. Set the variables

```bash
railway variables \
  --set CAPITAL_API_KEY=... \
  --set CAPITAL_IDENTIFIER=... \
  --set CAPITAL_API_PASSWORD=... \
  --set CAPITAL_ENVIRONMENT=live \
  --set ADMIN_LOGIN=... \
  --set ADMIN_PASSWORD=...
```

`CAPITAL_IDENTIFIER` is the Capital.com account email, and
`CAPITAL_API_PASSWORD` the password set on the API key rather than the account
password. `CAPITAL_ENVIRONMENT` is `live` or `demo`; both are read-only, as no
trading endpoint is reachable from the client.

`ADMIN_LOGIN` and `ADMIN_PASSWORD` create the first administrator, once, while
the user table is still empty. They are read on every request and ignored from
the second account onwards, so a restart never resets anyone's password and
leaving them set is harmless. Everyone else is added from the **Доступ** page.

`PORT` must be left alone. Railway injects one of its own — `8080` — and points
the generated domain at the same number; the server reads it and listens there,
and the `3000` in the image is only the default for running it outside Railway.
Setting `PORT` by hand moves the server without moving the domain, and every
request then comes back as a 502 from a container that is running perfectly
well. `railway domain --port` does not repoint a domain that already exists, so
the way back is to delete the variable:

```bash
railway variable delete PORT
```

Do not set `DATABASE_PATH` or `SETTINGS_PATH` unless the volume is mounted
somewhere other than `/data`.

## 4. Expose it

**Settings → Networking → Generate domain**, on port `3000`.

The health check is `GET /login`, which renders the sign-in page and opens the
database — enough to tell a container that is serving from one that merely
started. It answers before any Capital.com call is made, so a market-data
outage cannot roll a deployment back.

## 5. Check the deployment

```bash
railway logs
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/login
```

Then sign in with the administrator credentials and confirm the board prices a
market. Prices arriving as `snapshot` rather than `stream` mean the websocket
did not connect; the REST snapshot keeps the board alive, but it can run minutes
behind, and the logs will say why.

## Notes

- **One replica.** Scaling out would give each container its own candle cache,
  its own tick socket and no access to the volume the others hold.
- **Region.** The service talks to Capital.com on every poll; a region near
  their London endpoints keeps the round trip short.
- **Backups.** The whole state is three files in `/data`. Backups are switched
  on per volume in the dashboard, under the volume's **Backups** tab; there is
  no CLI command for it. `railway ssh` reaches the files for anything more
  specific.
- **Postgres.** Not used, and not needed while the service runs as one replica:
  the data layer is synchronous SQLite in the same process, which is what makes
  a once-a-second poll cheap. Moving to Postgres means making every read async
  all the way up through the strategy code, so it is worth doing for external
  access or managed backups, and not for capacity.
