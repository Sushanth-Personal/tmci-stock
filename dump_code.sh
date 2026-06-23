#!/bin/bash
# Run this from your project root: bash dump_code.sh
# Outputs all code to tmci_codebase.txt

OUTPUT="tmci_stock.txt"
> "$OUTPUT"

EXTENSIONS=("jsx" "js" "ts" "tsx" "css" "json" "md")

EXCLUDE_DIRS=("node_modules" ".next" ".git" "dist" "build" ".turbo" "coverage")

build_exclude() {
  local args=()
  for d in "${EXCLUDE_DIRS[@]}"; do
    args+=(-path "*/$d" -prune -o)
  done
  echo "${args[@]}"
}

echo "========================================" >> "$OUTPUT"
echo "  TMCI CODEBASE DUMP" >> "$OUTPUT"
echo "  Generated: $(date)" >> "$OUTPUT"
echo "  Root: $(pwd)" >> "$OUTPUT"
echo "========================================" >> "$OUTPUT"
echo "" >> "$OUTPUT"

find . \
  -path "*/node_modules" -prune -o \
  -path "*/.next" -prune -o \
  -path "*/.git" -prune -o \
  -path "*/dist" -prune -o \
  -path "*/build" -prune -o \
  -path "*/.turbo" -prune -o \
  -path "*/coverage" -prune -o \
  -type f \( \
    -name "*.jsx" -o \
    -name "*.js" -o \
    -name "*.ts" -o \
    -name "*.tsx" -o \
    -name "*.css" -o \
    -name "*.md" \
  \) -print | sort | while read -r file; do
    echo "" >> "$OUTPUT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$OUTPUT"
    echo "FILE: $file" >> "$OUTPUT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$OUTPUT"
    cat "$file" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
done

# Count stats
TOTAL=$(grep -c "^FILE:" "$OUTPUT" 2>/dev/null || echo 0)
LINES=$(wc -l < "$OUTPUT")
echo "" >> "$OUTPUT"
echo "========================================" >> "$OUTPUT"
echo "  TOTAL FILES: $TOTAL" >> "$OUTPUT"
echo "  TOTAL LINES: $LINES" >> "$OUTPUT"
echo "========================================" >> "$OUTPUT"

echo "Done. Output: $OUTPUT ($TOTAL files, $LINES lines)"