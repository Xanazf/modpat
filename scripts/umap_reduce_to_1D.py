#!/bin/python

import numpy as np
import umap
import os
import sys
from collections import Counter


def detect_dimension(input_path: str, sample_lines: int = 100) -> int:
    """
    Heuristically detects the vector dimension by counting float-convertible 
    elements from the end of the first few lines.
    """
    counts = Counter()
    try:
        with open(input_path, "r", encoding="utf-8") as f:
            for _ in range(sample_lines):
                line = f.readline()
                if not line:
                    break
                parts = line.strip().split()
                if len(parts) < 2:
                    continue
                
                # Count trailing parts that are convertible to float
                float_count = 0
                for p in reversed(parts):
                    try:
                        float(p)
                        float_count += 1
                    except ValueError:
                        break
                if float_count > 0:
                    counts[float_count] += 1
    except Exception as e:
        print(f"Error during dimension detection: {e}")
        return 0
    
    if not counts:
        return 0
    
    # Return the most common float count found at the end of lines
    return counts.most_common(1)[0][0]


def process_glove(input_path: str, dict_output: str, binary_output: str):
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        sys.exit(1)

    expected_dim = detect_dimension(input_path)
    if expected_dim == 0:
        print("Error: Could not determine vector dimension. Check input file format.")
        sys.exit(1)
        
    print(f"Detected expected dimension: {expected_dim}")

    words = []
    vectors = []

    print(f"Reading {input_path}...")
    with open(input_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            parts = line.strip().split()
            # A valid line must have at least the word and the vector
            if len(parts) < expected_dim + 1:
                continue
            
            # The last 'expected_dim' parts are the vector
            vec_parts = parts[-expected_dim:]
            # Everything before that is the word
            word = " ".join(parts[:-expected_dim])
            
            try:
                # Force float32 for numerical consistency
                vec = np.array(vec_parts, dtype="float32")
                words.append(word.lower()) 
                vectors.append(vec)
            except ValueError:
                continue

    if not vectors:
        print("Error: No valid vectors were loaded.")
        sys.exit(1)

    data = np.vstack(vectors)
    print(f"Loaded {len(words)} vectors. Array shape: {data.shape}")

    # UMAP Configuration
    print("Starting UMAP reduction...")
    reducer = umap.UMAP(
        n_neighbors=15,
        min_dist=0.1,
        n_components=1,
        metric="cosine",
        low_memory=True,
        random_state=42,
    )

    embedding = reducer.fit_transform(data)
    umap_1d = embedding.flatten().astype(np.float64)

    # Normalization
    u_min, u_max = umap_1d.min(), umap_1d.max()
    if u_max > u_min:
        umap_normalized = (umap_1d - u_min) / (u_max - u_min)
    else:
        umap_normalized = umap_1d - u_min

    print(f"Writing dictionary (Newline-separated) to {dict_output}...")
    with open(dict_output, "w", encoding="utf-8") as f:
        # Use newline instead of comma to handle punctuation words like ','
        f.write("\n".join(words))

    print(f"Writing binary Float64 data to {binary_output}...")
    with open(binary_output, "wb") as f:
        f.write(umap_normalized.tobytes())

    print("Successfully completed UMAP processing.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python umap_reduce_to_1D.py <input_path> [dict_output] [binary_output]")
        sys.exit(1)

    input_file = sys.argv[1]
    dict_out = sys.argv[2] if len(sys.argv) > 2 else "data/dictionary.txt"
    bin_out = sys.argv[3] if len(sys.argv) > 3 else "data/umap_data.bin"

    process_glove(input_file, dict_out, bin_out)
