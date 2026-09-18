#!/usr/bin/env bash
# 一鍵部署：前端（Cloudflare Pages，production=main 分支）＋ 後端（Worker exam-api）
#
# 用法：
#   ./deploy.sh          # 前端 Pages + 後端 Worker 都部署
#   ./deploy.sh --front  # 只部署前端 Pages（根網域 exam-egg.pages.dev）
#   ./deploy.sh --back   # 只部署後端 Worker（exam-api.ples.workers.dev）
#
# 注意：
# - Pages 專案 exam 的 production_branch 是 main（不是 master），
#   必須用 --branch main 才會更新根網域 exam-egg.pages.dev。
#   若漏掉 --branch，wrangler 4.134 會拿去 git 的 master 分支（變成 preview 別名），
#   線上就一直是舊版。此問題已踩過兩次，務必保留 --branch main。
set -euo pipefail
cd "$(dirname "$0")"

FRONT_ONLY=0
BACK_ONLY=0
case "${1:-}" in
  --front) FRONT_ONLY=1 ;;
  --back)  BACK_ONLY=1 ;;
  "" ) FRONT_ONLY=1; BACK_ONLY=1 ;;
  *) echo "⚠ 未知參數：$1（可用 :all / --front / --back）"; exit 1 ;;
esac

if [ "$FRONT_ONLY" = "1" ]; then
  echo "──────────────────────────────────────────────"
  echo "① 部署前端 Pages → production 分支 main（根網域 exam-egg.pages.dev）"
  echo "──────────────────────────────────────────────"
  npx wrangler pages deploy . --project-name exam --branch main --commit-dirty=true
  echo "✅ 前端已更新：https://exam-egg.pages.dev/admin"
fi

if [ "$BACK_ONLY" = "1" ]; then
  echo
  echo "──────────────────────────────────────────────"
  echo "② 部署後端 Worker exam-api"
  echo "──────────────────────────────────────────────"
  (cd worker && npx wrangler deploy)
  echo "✅ Worker 已更新：https://exam-api.ples.workers.dev"
fi

echo
echo "🎉 全部完成！"
