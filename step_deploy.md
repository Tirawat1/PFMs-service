# Deploy PFMS to AWS EC2 (Docker + nginx + DuckDNS + GitHub Actions)

Single EC2 instance, no RDS — Postgres runs as a container next to the app.
Auto-deploys on every push to `main` via GitHub Actions.

```
Internet → DuckDNS (name → Elastic IP) → EC2 :80/:443 (nginx, TLS)
                                              │
                                    proxy_pass → 127.0.0.1:3000
                                              │
                              docker compose: app container ↔ db container (postgres, internal only)
```

---

## 0. Prerequisites

- AWS account + [Terraform](https://developer.hashicorp.com/terraform/install) installed locally
- An SSH key pair imported into AWS EC2 (**Terraform does not create this** — the private key must never pass through Terraform state):
  ```bash
  aws ec2 import-key-pair \
    --key-name pfms-key \
    --public-key-material fileb://~/.ssh/id_ed25519.pub
  ```
  (or create a key pair from the EC2 console and download the `.pem`)
- A free [DuckDNS](https://www.duckdns.org) account → create a subdomain, e.g. `pfms-yourname.duckdns.org`, note its **token**
- This repo pushed to GitHub

---

## 1. Provision the EC2 instance with Terraform

```bash
cd terraform
terraform init
terraform apply \
  -var="key_pair_name=pfms-key" \
  -var="ssh_allowed_cidr=YOUR_IP/32"
```

This creates:
- 1× EC2 instance (Ubuntu 22.04, `t3.small` by default — Postgres + Node need more than a micro's 1GB RAM)
- Security group: 22 (restricted to `ssh_allowed_cidr`), 80, 443 open
- An **Elastic IP** attached to the instance (needed so the IP doesn't change on reboot — DuckDNS points at it once and stays valid)
- `user_data.sh` runs on first boot: installs Docker, the Compose plugin, nginx, certbot

Note the `public_ip` output — that's your static IP.

```bash
terraform output
```

> **Optional: RDS instead of the bundled Postgres container.** Not covered by
> this Terraform (out of scope per your "EC2 only for now" plan), but if you
> switch later: provision an `aws_db_instance`, open the app's security group
> to reach it, remove the `db` service from `docker-compose.yml`, and set
> `DATABASE_URL` directly to the RDS endpoint in `.env`. No app code changes
> needed — Prisma only cares about `DATABASE_URL`.

---

## 2. Point DuckDNS at the Elastic IP

```bash
curl "https://www.duckdns.org/update?domains=pfms-yourname&token=YOUR_DUCKDNS_TOKEN&ip=<public_ip from terraform output>"
```

Since the IP is a static Elastic IP (not the ephemeral default), you only need to do this once — no renewal cron required. (If you ever detach the EIP, re-run this.)

---

## 3. First-time server setup (manual, one-off)

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<public_ip>

# clone the repo where GitHub Actions will also deploy from
sudo mkdir -p /opt/pfms && sudo chown ubuntu:ubuntu /opt/pfms
git clone https://github.com/<you>/pfms-app.git /opt/pfms
cd /opt/pfms

# real production env — never commit this
cp .env.production.example .env
nano .env   # fill in POSTGRES_PASSWORD, AUTH_SECRET (openssl rand -hex 32), ADMIN_USERNAME/PASSWORD, etc.

docker compose build
docker compose up -d
docker compose logs -f app   # watch it come up, Ctrl+C when healthy
```

App is now listening on `127.0.0.1:3000` on the host (not yet public — nginx handles that next).

---

## 4. nginx reverse proxy + HTTPS (Let's Encrypt via certbot)

```bash
sudo cp /opt/pfms/deploy/nginx/pfms.conf /etc/nginx/sites-available/pfms
sudo sed -i 's/YOURNAME.duckdns.org/pfms-yourname.duckdns.org/' /etc/nginx/sites-available/pfms
sudo ln -s /etc/nginx/sites-available/pfms /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# issues the cert AND rewrites the nginx config to add the HTTPS server block + redirect
sudo certbot --nginx -d pfms-yourname.duckdns.org
```

Certbot's snap install sets up its own renewal timer automatically — no cron needed. Verify anytime with `sudo certbot renew --dry-run`.

Visit `https://pfms-yourname.duckdns.org` — you should see the PFMS login page.

---

## 5. GitHub Actions: auto-deploy on push to `main`

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `EC2_HOST` | the Elastic IP (or `pfms-yourname.duckdns.org`) |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | full private key content: `cat ~/.ssh/id_ed25519` (include the `-----BEGIN/END-----` lines) |

Workflow is already at [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — on every push to `main` it SSHes in, `git pull`s, rebuilds, and restarts the `app` container. The `db` container and its volume are untouched (`prisma db push` in the entrypoint only adds/updates schema, never drops data outside of a real destructive migration).

Test it:
```bash
git push origin main
# watch: repo → Actions tab
```

---

## 6. Day-2 operations

- **Logs:** `docker compose logs -f app` / `docker compose logs -f db`
- **Manual redeploy:** `cd /opt/pfms && git pull && docker compose up -d --build`
- **DB backup** (no RDS snapshots here — do this yourself, e.g. weekly cron):
  ```bash
  docker compose exec db pg_dump -U pfms pfms > backup-$(date +%F).sql
  ```
- **Restore:** `cat backup-2026-07-12.sql | docker compose exec -T db psql -U pfms pfms`
- **Seed demo data once:** set `SEED_ON_START=true` in `.env`, `docker compose up -d`, watch logs for "Seeded baseline + demo data", then set it back to `false` and `docker compose up -d` again (re-seeding is a no-op on a non-empty DB, but keep it off by default).

## 7. Teardown

```bash
cd terraform
terraform destroy -var="key_pair_name=pfms-key" -var="ssh_allowed_cidr=YOUR_IP/32"
```

This deletes the EC2 instance, security group, and releases the Elastic IP. The Postgres data volume lives *inside* the instance's EBS root volume — it is destroyed with the instance. Back up first if needed.
