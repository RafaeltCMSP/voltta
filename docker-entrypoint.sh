#!/bin/sh
set -e

echo "→ Aplicando schema no banco (prisma db push)..."
npx prisma db push --skip-generate

echo "→ Subindo o Voltta..."
exec node dist/index.js
