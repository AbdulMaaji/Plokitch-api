# Plokitch Server

Backend API for the Plokitch platform — a ghost kitchen marketplace connecting customers with home chefs and delivery riders.

## Tech Stack

- **Runtime**: Node.js v22 + TypeScript
- **Framework**: Fastify v4
- **ORM**: Drizzle ORM
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Better Auth
- **Dev**: `tsx watch` for hot reload

## Getting Started

### 1. Set up environment variables

```bash
cp .env.example .env
```

Then edit `.env` and fill in your `DATABASE_URL`. You can copy the full connection string from:

> **Supabase Dashboard → Settings → Database → Connection string (URI mode)**

It will look like:
```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run database migrations

```bash
# Generate migration files from schema
npm run db:generate

# Push schema to Supabase (for development)
npm run db:push

# OR run migrations
npm run db:migrate
```

### 4. Start the dev server

```bash
npm run dev
```

The API will be available at `http://localhost:4000`.

---

## API Endpoints

### Public
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/vendors` | List all active kitchens |
| `GET` | `/api/vendors/:id` | Kitchen detail + menu |
| `GET` | `/api/vendors/:id/menu` | Menu items for a kitchen |

### Auth (Better Auth)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/sign-up/email` | Register |
| `POST` | `/api/auth/sign-in/email` | Login |
| `POST` | `/api/auth/sign-out` | Logout |
| `GET` | `/api/auth/session` | Get session |

### Users (Protected)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/users/me` | My profile |
| `PATCH` | `/api/users/me` | Update profile |
| `GET` | `/api/users` | All users (admin) |

### Vendors / Kitchens (Protected)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/vendors` | Create kitchen |
| `PATCH` | `/api/vendors/:id` | Update kitchen |
| `POST` | `/api/vendors/:id/menu` | Add menu item |
| `PATCH` | `/api/vendors/:id/menu/:itemId` | Update menu item |
| `DELETE` | `/api/vendors/:id/menu/:itemId` | Delete menu item |

### Orders (Protected)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/orders` | Place order |
| `GET` | `/api/orders` | My orders (role-filtered) |
| `GET` | `/api/orders/:id` | Order detail |
| `PATCH` | `/api/orders/:id/status` | Update order status |

### Riders (Protected)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/riders` | Create rider profile |
| `GET` | `/api/riders/me` | My rider profile |
| `PATCH` | `/api/riders/me` | Update availability / location |
| `GET` | `/api/riders/available` | Available riders (admin/chef) |

### Admin (Admin only)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/stats` | Platform statistics |
| `PATCH` | `/api/admin/vendors/:id/verify` | Verify a kitchen |
| `PATCH` | `/api/admin/users/:id/status` | Activate/deactivate user |

---

## User Roles

| Role | Access |
|------|--------|
| `customer` | Browse kitchens, place orders |
| `chef` | Manage kitchen & menu, view kitchen orders |
| `rider` | View assigned deliveries, update availability |
| `admin` | Full platform access |

## Project Structure

```
server/
├── src/
│   ├── index.ts              # Fastify server entry point
│   ├── db/
│   │   ├── index.ts          # Drizzle connection
│   │   ├── schema.ts         # Database schema (all tables)
│   │   └── migrate.ts        # Migration runner
│   ├── lib/
│   │   └── auth.ts           # Better Auth instance
│   ├── middleware/
│   │   ├── auth.middleware.ts # requireAuth, requireRole
│   │   └── error.middleware.ts # Global error handler
│   └── routes/
│       ├── auth.routes.ts    # Better Auth catch-all
│       ├── users.routes.ts
│       ├── vendors.routes.ts # + menu item sub-routes
│       ├── orders.routes.ts
│       ├── riders.routes.ts
│       └── admin.routes.ts
├── drizzle/                  # Generated migration files (gitignored)
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env                      # Local secrets (gitignored)
└── .env.example              # Template
```
