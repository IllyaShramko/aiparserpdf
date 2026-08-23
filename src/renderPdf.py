import sys
import os
import json
import pymupdf

def render_pdf(pdf_path: str, output_dir: str, dpi: int = 150):
    os.makedirs(output_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    page_files = []
    for i, page in enumerate(doc):
        out_file = os.path.join(output_dir, f"page_{i+1:03d}.png")
        pix = page.get_pixmap(dpi=dpi)
        pix.save(out_file)
        page_files.append(out_file)
    print(json.dumps({"pageCount": len(doc), "files": page_files}))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python renderPdf.py <pdf_path> <output_dir> [dpi]")
        sys.exit(1)
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    render_pdf(sys.argv[1], sys.argv[2], dpi)
