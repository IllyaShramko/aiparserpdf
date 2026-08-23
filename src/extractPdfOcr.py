import sys
import os
import pymupdf
import numpy as np
from rapidocr_onnxruntime import RapidOCR

def extract_pdf_to_markdown(pdf_path: str, output_md_path: str, dpi: int = 200) -> dict:
    doc = pymupdf.open(pdf_path)
    engine = RapidOCR()
    
    pages_text = []
    total_words = 0
    
    for page_num, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
        
        # Если 4 канала (RGBA), берем первые 3 (RGB)
        if pix.n == 4:
            img = img[:, :, :3]
            
        result, _ = engine(img)
        
        if result:
            # Сортируем блоки по вертикали (y0), затем по горизонтали (x0)
            # line structure in RapidOCR: [dt_boxes, text, score]
            # dt_boxes: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            lines = [line[1] for line in result if line[1].strip()]
            page_text = "\n".join(lines)
        else:
            page_text = ""
            
        pages_text.append(page_text)
        total_words += len(page_text.split())
        
    full_markdown = "\n\n<!-- PAGE_BREAK -->\n\n".join(pages_text)
    
    os.makedirs(os.path.dirname(output_md_path), exist_ok=True)
    with open(output_md_path, "w", encoding="utf-8") as f:
        f.write(full_markdown)
        
    return {
        "pageCount": len(doc),
        "totalWords": total_words,
        "totalChars": len(full_markdown),
        "outputPath": output_md_path
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extractPdfOcr.py <pdf_path> <output_md_path> [dpi]")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    output_md_path = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    
    res = extract_pdf_to_markdown(pdf_path, output_md_path, dpi)
    # Печатаем ASCII-safe JSON для Windows консоли
    import json
    print(json.dumps(res, ensure_ascii=True))
