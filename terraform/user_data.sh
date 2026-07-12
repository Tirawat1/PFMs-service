#!/bin/bash
set -euxo pipefail

apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx

# Docker Engine + Compose plugin (official repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

usermod -aG docker ubuntu

# Certbot via snap (Let's Encrypt)
snap install core; snap refresh core
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot

systemctl enable docker
systemctl enable nginx

mkdir -p /opt/pfms
chown ubuntu:ubuntu /opt/pfms
