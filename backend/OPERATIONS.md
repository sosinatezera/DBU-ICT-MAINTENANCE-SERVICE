# Backup and maintenance operations

## Authentication

Login and Google Sign-In return a signed, stateless HS256 bearer token. The
browser stores it in local storage and sends it in the `Authorization: Bearer`
header for protected API and Socket.IO requests. Tokens expire after 12 hours;
there is no server-side idle timeout, session cookie, or MongoDB session store.
Protected requests still load the account from MongoDB, so deactivated users
and changed roles take effect immediately.

Set `JWT_SECRET` to a random value of at least 32 characters in production.
Because access tokens are stateless, sign-out removes the token from the
browser; a copied token remains usable until its 12-hour expiry. Use HTTPS and
keep frontend script injection protections in place because browser storage is
accessible to JavaScript.

## Google Sign-In

Google Sign-In uses Google Identity Services (GIS) to return an ID token to
the login page. The backend verifies its RS256 signature against Google's
HTTPS-served OIDC signing keys and checks issuer, audience, expiry,
verified-email claim, and a short-lived signed nonce challenge, then returns
the same bearer-token format as password login. Signing keys are cached only
for their published cache lifetime and refreshed for an unknown key ID. The
Google ID token is never stored. Google login is limited to an existing, active
account whose email matches Google's verified email; it does not create
accounts or assign roles. New users must use the normal registration/approval
process, which continues to create Requester accounts only.

Create an OAuth 2.0 Client ID of type **Web application** in Google Cloud
Console. Add these exact authorized JavaScript origins:

- `https://simms-mau.netlify.app`
- `https://simms-ict-maintenance-system.netlify.app`
- `http://localhost:3000` and `http://127.0.0.1:3000` for local development

Add every additional production frontend origin to both the Google client and
the backend `FRONTEND_ORIGINS` allow-list. This GIS ID-token flow uses no OAuth
redirect URI and needs no client secret. Set `GOOGLE_CLIENT_ID` in
`backend/.env` locally and in the Render service environment in production.
The login page retrieves this public client ID and a short-lived nonce
challenge from `GET /api/auth/google/config`; the value is not embedded in
frontend source.

The frontend may call the backend through its same-origin Netlify `/api/*`
proxy or use an explicitly configured API origin. Keep production HTTPS and
the state-changing Origin allow-list enabled. Deploy the backend first, then
the frontend assets. A deployment is not enabled until the Google client
and Render environment variable are configured and sign-in has been verified
with an actual Google account for each applicable role.

## Database backups

The Admin Settings page uses the Admin-only `GET /api/settings/backups` route
to list backups and `POST /api/settings/backups` to start one. Verified archive
downloads use `GET /api/settings/backups/:id/download`. The controller creates
compressed MongoDB archives with `mongodump` and verifies them with
`mongorestore --dryRun`; metadata, file size, and SHA-256 are recorded. Restore,
automatic scheduling, and automatic retention deletion are intentionally not
enabled.

In production, configure `BACKUP_DIR` as an absolute path on a persistent,
private mounted volume. After verifying the mount and access policy, also set
`BACKUP_DIR_PERSISTENCE_CONFIRMED=true`; backup readiness is intentionally
blocked without this explicit production confirmation. The confirmation is an
operator attestation, not automatic detection that a volume is persistent. The
default development path is
`backend/private_backups/database`; it is not suitable for ephemeral production
storage. The service creates the directory with owner-only permissions on
POSIX systems and rejects paths inside the frontend or upload directories.

The current Render Blueprint uses the `free` plan and declares no persistent
disk. Do not set the production confirmation or create production backups on
that ephemeral filesystem. Provision and mount private persistent storage (or
implement a private object-storage backend) before enabling backups. A paid
Render disk can incur charges and must be provisioned through the authorized
Render configuration.

Install MongoDB Database Tools on the backend host and make `mongodump` and
`mongorestore` available on `PATH`. If needed, set `MONGODUMP_PATH` and
`MONGORESTORE_PATH` to their executable paths. Database credentials are read
from the backend's existing Mongo configuration and written temporarily to a
private config file that is removed when the operation finishes.

On Windows, restrict the configured backup directory ACL to the service
account before setting `BACKUP_DIR_ACL_CONFIRMED=true`; otherwise backup
storage is reported unavailable. Backups should be copied to a separate
protected location according to the organization's retention and disaster
recovery policy.

## Maintenance mode

The `maintenanceMode` and `maintenanceNotice` values are stored in the
existing Settings document. The backend maintenance middleware blocks
non-admin API and protected upload requests. Login, sign-out, the public
maintenance notice, and authenticated Admin requests remain
available so an Admin can disable maintenance mode.

The public status endpoint is `GET /api/public/maintenance-mode`. Admin
controls use `GET /api/settings/maintenance` and
`PUT /api/settings/maintenance`. Maintenance scheduling is not available.
