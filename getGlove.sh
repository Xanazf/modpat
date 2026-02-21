#!/bin/bash

base_link="https://nlp.stanford.edu/data/wordvecs"
archive_wg="glove.2024.wikigiga"
archive_dolma="glove.2024.dolma"
archive_50d_wg="$archive_wg.50d"
archive_100d_wg="$archive_wg.100d"
archive_200d_wg="$archive_wg.200d"
archive_300d_wg="$archive_wg.300d"
archive_300d_dolma="$archive_dolma.300d"
link_wg="$base_link/$archive_wg"
link_dolma="$base_link/$archive_dolma"
dest="data"

# Check if UMAP data already exists to avoid redundant downloads
if [[ -f "$dest/dictionary.txt" && -f "$dest/umap_data.bin" ]]; then
  echo "UMAP data already exists in $dest. Skipping download."
  exit 0
fi

# Check if raw text file exists to skip download and go straight to processing
check_existing_txt() {
  local existing_txt=$(ls "$dest"/*.txt 2>/dev/null | head -n 1)
  if [[ -n "$existing_txt" ]]; then
    echo "Found existing raw GloVe data: $existing_txt. Skipping download."
    process_data
    exit 0
  fi
}

mkdir -p "$dest"

process_data() {
  local exa_file=$(ls "$dest"/*.txt | head -n 1)
  local txt_file=${exa_file##" "}
  if [[ -f "$txt_file" ]]; then
    echo "Processing $txt_file with UMAP..."
    if ./scripts/venv/bin/python3 scripts/umap_reduce_to_1D.py "$txt_file" "$dest/dictionary.txt" "$dest/umap_data.bin"; then
      echo "Deleting original file $txt_file..."
      rm "$txt_file"
    else
      echo "Error: UMAP processing failed. Original file $txt_file was not deleted."
      exit 1
    fi
  else
    echo "Error: No .txt file found in $dest after unzip."
    exit 1
  fi
}

# Run the check before doing any work
check_existing_txt

case "$1" in
50d)
  echo "selected 50d"
  curl -LO "$link_wg.50d.zip"
  if [[ -f "$archive_50d_wg.zip" ]]; then
    unzip "$archive_50d_wg.zip" -d "$dest"
    rm "$archive_50d_wg.zip"
    process_data
  fi
  ;;
100d)
  echo "selected 100d"
  curl -LO "$link_wg.100d.zip"
  if [[ -f "$archive_100d_wg.zip" ]]; then
    unzip "$archive_100d_wg.zip" -d "$dest"
    rm "$archive_100d_wg.zip"
    process_data
  fi
  ;;
200d)
  echo "selected 200d"
  curl -LO "$link_wg.200d.zip"
  if [[ -f "$archive_200d_wg.zip" ]]; then
    unzip "$archive_200d_wg.zip" -d "$dest"
    rm "$archive_200d_wg.zip"
    process_data
  fi
  ;;
300d)
  if [ "$2" == "dolma" ]; then
    echo "selected 300d dolma"
    curl -LO "$link_dolma.300d.zip"
    if [[ -f "$archive_300d_dolma.zip" ]]; then
      unzip "$archive_300d_dolma.zip" -d "$dest"
      rm "$archive_300d_dolma.zip"
      process_data
    fi
  else
    echo "selected 300d wikigiga"
    curl -LO "$link_wg.300d.zip"
    if [[ -f "$archive_300d_wg.zip" ]]; then
      unzip "$archive_300d_wg.zip" -d "$dest"
      rm "$archive_300d_wg.zip"
      process_data
    fi
  fi
  ;;
*)
  echo "select dimensionality: 50d | 100d | 200d | 300d"
  echo "note: '300d dolma' will download dolma"
  ;;
esac
