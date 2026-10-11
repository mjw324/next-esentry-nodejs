#!/bin/sh
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
CODENAME=$(lsb_release -cs)
# PostgreSQL (PGDG)
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" > /etc/apt/sources.list.d/pgdg.list
# Redis (packages.redis.io)
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor --yes -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $CODENAME main" > /etc/apt/sources.list.d/redis.list
apt-get update -qq
apt-get install -y -qq postgresql-16 redis >/dev/null
echo INSTALLED
/usr/lib/postgresql/16/bin/postgres --version
redis-server --version
