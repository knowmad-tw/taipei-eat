#!/bin/bash
# 每日自動核對（launchd: com.knowmad.taipei-eat-verify，每天 09:30）
# 每月 1 號：大批次 4800 筆（額度重置日，一口氣吃滿當月免費 Text Search）
# 其他日子：190 筆（額度沒了會撞 429 自動停，$0）
cd "$(dirname "$0")/.." || exit 1
if [ "$(date +%d)" = "01" ]; then LIMIT=4800; else LIMIT=190; fi
{
  echo "===== $(date '+%F %T') limit=$LIMIT ====="
  python3 scripts/verify_osm.py --limit "$LIMIT"
  python3 scripts/verify_osm.py --booking --limit 30
} >> logs/verify.log 2>&1
