# ShopSmart

ShopSmart is an early, locally runnable commerce experience for discovering independent brands and more considered products. This repository includes a customer-facing storefront, an Express/Prisma catalog API foundation, and a separately deployable deterministic FastAPI intelligence baseline.

> **Current implementation status:** The storefront catalog reads administrator-approved published products, categories, prices, variants, stock and review summaries from PostgreSQL through the API. Search, category/budget filters, price sorting and pagination are server-backed; product details are fetched by slug. The seeded catalog is synthetic demonstration content, images are URLs stored with product records, wishlist/bag persistence remains browser-only, and checkout is disabled. Customer registration, login, rotating refresh sessions, profile management, email verification, password reset and database-backed role/ownership guards are implemented. Seller applications support saved drafts, review/history, transactional approval, seller-role activation, seller profile management, administration and public verified storefronts. Seller product APIs support ownership-scoped listing, creation, editing and archival; new products require moderation, and initial stock is ledgered transactionally. Seller inventory APIs support atomic stock adjustments, immutable paginated history, per-variant low-stock thresholds and seller-scoped low-stock detection. Administrator product moderation APIs support pending queues, product review, approval, disabling with a reason, and explicit return to pending review with transactional audit records. Admin/seller product and inventory UI, notifications, fulfillment, staff, settlements and analytics are not included. Email verification and password recovery require a configured email-delivery endpoint. The AI API is a deterministic keyword/lexicon baseline, not a trained model. Checkout/payment and production AI are not implemented. No order is placed and no payment is taken.

## Run the storefront

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. In development, the storefront uses Vite's same-origin `/api` proxy to the API configured by `VITE_API_BASE_URL` (default `http://127.0.0.1:4000`), allowing secure refresh cookies without storing tokens in the browser. Production builds use `VITE_API_BASE_URL` directly, or default to the API on port 4000 at the current host. The API's `WEB_ORIGIN` must include the exact storefront origin when calling it directly. Validate the frontend with `npm run lint`, `npm test`, and `npm run build`.

## Repository map

```text
src/                  Responsive React + TypeScript storefront
docs/                 Architecture decisions and milestone checklist
apps/api/              Express/Prisma commerce API foundation and schema
apps/ai-service/       Independent FastAPI deterministic intelligence baselines
```

## Run the API

Requirements: Node.js 20.19+ or 22.12+, npm, and Docker Compose v2. PostgreSQL and Redis can be started with Docker Compose.

Create a root `.env` from the template, then generate local-only database and signing secrets. The generated values below use URL-safe characters so the database password can be embedded in `DATABASE_URL` without escaping. Keep `.env` untracked and never share its contents.

```powershell
Copy-Item .env.example .env
$dbPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$authSecret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$settings = Get-Content .env
$settings = $settings -replace '^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$dbPassword"
$settings = $settings -replace '^DATABASE_URL=.*$', "DATABASE_URL=postgresql://shopsmart:$dbPassword@localhost:5432/shopsmart?schema=public"
$settings = $settings -replace '^AUTH_ACCESS_SECRET=.*$', "AUTH_ACCESS_SECRET=$authSecret"
Set-Content .env $settings

docker compose up -d postgres redis
```

For an existing Compose database volume, retain the password already configured for its PostgreSQL role; changing `POSTGRES_PASSWORD` does not alter credentials in an initialized volume. Do not remove the volume to resolve a connection failure.

```powershell
npm install --prefix apps/api
npm run db:validate --prefix apps/api
npm run db:generate --prefix apps/api
npm run db:migrate --prefix apps/api
npm run db:seed --prefix apps/api
npm run test:integration --prefix apps/api
npm run dev --prefix apps/api
```

For the full containerized application instead of a host-run API, start the services after configuring `.env`:

```powershell
docker compose up --build
```

Compose applies pending Prisma migrations before starting the API. The storefront is served at `http://localhost:8080`; API and AI health endpoints use ports 4000 and 8000. The optional synthetic catalog seed is still a separate command.

The API listens on port 4000 by default. The API and Prisma scripts load the root `.env` before using configuration; set `ENV_FILE` to select another env file. `GET /healthz` is a liveness check and `GET /readyz` verifies PostgreSQL connectivity. Run `npm run test:integration --prefix apps/api` to verify readiness, catalog retrieval, registration/login, profile ownership, role restrictions, email verification, password reset, refresh, expiration and logout against PostgreSQL. The suite creates uniquely named fixtures and removes only those fixtures; it does not reset or truncate the database. Run `npm test --prefix apps/api` for the non-database API tests. Registration/login issue a ten-minute signed access token and a rotating opaque refresh token stored only as a hash in PostgreSQL; every authenticated request loads the user's current role from PostgreSQL. Refresh cookies are httpOnly; they use SameSite=Strict in development and Secure/SameSite=None in production with a required allowed-Origin check. Passwords use salted scrypt hashes. Email action tokens are single-use, hashed at rest and expire (24 hours for verification, 1 hour for reset); password reset revokes every active refresh session. Set `AUTH_EMAIL_DELIVERY_URL` and `AUTH_EMAIL_DELIVERY_API_KEY` to a trusted HTTPS endpoint that accepts `POST` JSON `{ "to", "subject", "text" }` with Bearer authentication. In development the endpoint may use localhost HTTP for testing. Compose requires `POSTGRES_PASSWORD` and `AUTH_ACCESS_SECRET` from `.env`; neither secret is committed. The seed contains explicitly synthetic demonstration records and random inaccessible account hashes; it does not create usable credentials. Public registration always creates a `CUSTOMER`; privileged roles are database-controlled. The API contract is in [apps/api/docs/openapi.yaml](apps/api/docs/openapi.yaml).

### Transactional email with Resend

The API uses Resend's email endpoint for verification and password-reset messages. Set `AUTH_EMAIL_DELIVERY_URL=https://api.resend.com/emails`, `AUTH_EMAIL_DELIVERY_API_KEY` to a server-side Resend API key, and `AUTH_EMAIL_FROM_ADDRESS` to the sender. For development, use `ShopSmart <onboarding@resend.dev>`; Resend's onboarding sender is restricted to its supported test-recipient workflow. The adapter sends a Bearer authorization header and a JSON body containing `from`, `to`, `subject`, and `text`. Keep the API key only in the server environment; never use a `VITE_` variable. Docker Compose passes all three settings into the API container. Configure them in the root `.env` before starting/recreating the Compose API service. Provider error details and credentials are not returned to the frontend.

### Initial Super Admin setup

Only use this one-time CLI when the platform has no `ADMIN` or `SUPER_ADMIN` account. Ensure the API has its normal database and signing configuration in the root `.env`, then register a separate account through the customer registration flow using the intended administrator email. Verify that address using the verification link delivered by the application; verification email delivery requires `AUTH_EMAIL_DELIVERY_URL` and `AUTH_EMAIL_DELIVERY_API_KEY` in the root `.env`. Configure these for a trusted provider endpoint implementing the JSON delivery contract above. For local testing, the endpoint may use localhost HTTP; use HTTPS for a non-local provider. Then run the command below from the repository root, replacing the address with the existing verified account:

```powershell
npm run admin:bootstrap --prefix apps/api -- --email admin@example.com
```

The CLI normalizes the email using the same trim/lowercase convention as registration, requires an existing verified `CUSTOMER`, and asks you to type the normalized email again before proceeding. The promotion and `SUPER_ADMIN_BOOTSTRAPPED` audit record are committed together. A PostgreSQL transaction-scoped advisory lock serializes bootstrap attempts; the second attempt sees the already-created administrator and is refused. It cannot change any other user, and there is no public bootstrap endpoint or startup promotion. After success, sign in through the normal login flow with the dedicated account; its current database role grants access to administrator-protected operations. The bootstrap intentionally refuses to run again after any administrator exists. Do not execute it as part of routine startup or seed commands.

## Run the AI baseline

```powershell
python -m venv apps/ai-service/.venv
apps/ai-service/.venv/Scripts/Activate.ps1
python -m pip install -r apps/ai-service/requirements.txt
Push-Location apps/ai-service
python -m uvicorn app.main:app --reload --port 8000
# In a second terminal: python -m pytest tests -q
Pop-Location
```

The Python API offers `/healthz`, `/v1/intent`, `/v1/search`, and `/v1/reviews/sentiment`. Its responses identify deterministic keyword/lexicon methods and must not be marketed as model-backed predictions. Model training, evaluation datasets, pgvector, and measurable Precision@K/Recall@K/nDCG/F1/MAE/RMSE remain future work.

The storefront catalog and account panel use the shared `/api` path in development and `VITE_API_BASE_URL` in production. `GET /api/v1/products` supports search (including specifications), category/seller, minimum/maximum price in minor currency units, stock availability, rating/price/newest sorting, and pagination; `GET /api/v1/products/categories` lists categories with published product counts; `GET /api/v1/products/:slug` returns current product details, multiple ordered images, specifications, active variants, stock, seller and review summary. Product prices are integers in minor currency units (paise for INR). The `ProductImage` relation stores URL, alt text, sort order and primary-image state; the additive product-media migration copies previously stored single-image values to that relation before dropping legacy columns. For a deployed frontend/API pair on different domains, configure `WEB_ORIGIN` to the exact frontend origin and set `VITE_API_BASE_URL` at web build time. Never put backend secrets in a `VITE_*` setting.

Seller onboarding is available from the signed-in account panel. Customers can save and submit one application; `PUT /api/v1/seller/applications/me` saves the draft and `POST /api/v1/seller/applications/me/submit` submits it. Administrators review through `/api/v1/seller/admin/applications` and its `/{applicationId}/review` endpoint. Only an approved application can activate the seller account; seller role and verified seller record are updated in the approval transaction. Approved sellers manage their public profile through `/api/v1/seller/me`; public store pages use `/api/v1/stores/{slug}` and show published catalog items from `/api/v1/products?seller={slug}`. Suspension revokes seller role access and hides the store/products. Business address and application history are private to the applicant and authorized administrators. Verification collects demonstration business information only—no identity documents or KYC provider integration. Seller product and inventory management APIs are available, but their UI, fulfillment, settlements and seller analytics remain future milestones.

## Configuration

Copy `.env.example` to `.env` when configuring backend services. Never commit `.env` or production credentials. Database, Redis, payment, image-provider, API-origin, and frontend API settings are documented in the template. `POSTGRES_PASSWORD` and `AUTH_ACCESS_SECRET` must be set for Compose; keep signing secrets server-side and never put them in `VITE_*` variables.

The Compose PostgreSQL database, username, URL and named volume have been renamed for ShopSmart. If migrating an existing local Compose deployment, back up and migrate the old database/volume before switching; do not remove the old volume until the new database is verified.

## Build plan and known limitations

See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for milestones, current completion evidence, and the next work items. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for service boundaries and data flow. The Docker Compose stack requires Docker Compose v2 and the root `.env` secrets described above.

The database catalog is connected, but the included product records are explicitly synthetic seed data. Bag and wishlist state persist in this browser only, not to an account or server. Catalog search is deterministic database text filtering, not semantic AI. No payment integration, inventory reservation, production seller verification, or deployed environment is implemented yet. See the milestone table in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) before treating this repository as a production marketplace.
