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
push to `master` deploys. Alternatively, deploy the working tree directly:

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
so nothing else has to be configured. A volume can only be attached to one
container at a time, which is why `railway.json` pins `numReplicas` to 1 and
sets `overlapSeconds` to 0: the old container must release the volume before the
new one claims it.

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

`PORT` is supplied by Railway and read by the server; it does not need to be
set. Do not set `DATABASE_PATH` or `SETTINGS_PATH` unless the volume is mounted
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
- **Backups.** The whole state is three files in `/data`. Railway snapshots the
  volume, and `railway ssh` reaches it for anything more specific.
- **Sleeping.** Serverless or app-sleeping modes must stay off: a process that
  is paused between requests loses the tick socket and the caches behind it.
