import React, { useState, useCallback } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import { FileText, Download, Upload, ZoomIn, ZoomOut, Loader2, Wand2, Image as ImageIcon, Menu, X, Printer } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { Document, Page, pdfjs } from 'react-pdf';

// PDF Worker Fix
try { pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`; } catch (e) { console.error(e); }

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// --- AYARLAR ---
const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-flash-latest" }) : null;

function App() {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [noteTitle, setNoteTitle] = useState("Ders Notu");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [pageRange, setPageRange] = useState(""); // Örn: "1-5, 8"
  
  // PDF State
  const [pdfFile, setPdfFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [scale, setScale] = useState(1.0); // 1.0 = %100 Genişlik (CSS ile zorlanacak)

  // --- TIPTAP EDİTÖR ---
  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, Image.configure({ inline: true, allowBase64: true })],
    content: `<h1>${noteTitle}</h1><p>Sayfa aralığı seçip not çıkarmaya başla...</p>`,
    editorProps: { 
      attributes: { class: 'focus:outline-none' },
      handlePaste: (view, event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (const item of items) {
          if (item.type.indexOf('image') === 0) return false; // Tiptap halleder
        }
        return false;
      }
    },
  });

  // --- SAYFA ARALIĞI PARSE EDİCİ ---
  const getPagesToProcess = (total) => {
    if (!pageRange.trim()) {
      // Boşsa hepsi
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = new Set();
    const parts = pageRange.split(',');
    
    parts.forEach(part => {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (start && end) {
          for (let i = start; i <= end; i++) if (i <= total) pages.add(i);
        }
      } else {
        const num = Number(part);
        if (num && num <= total) pages.add(num);
      }
    });
    
    return Array.from(pages).sort((a, b) => a - b);
  };

  // --- PDF MOTORU ---
  const extractTextFromPDF = async (file) => {
    setAiStatus("PDF Yükleniyor...");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument(arrayBuffer).promise;
    
    // Hangi sayfalar okunacak?
    const targetPages = getPagesToProcess(pdf.numPages);
    
    if (targetPages.length === 0) throw new Error("Seçilen aralıkta sayfa bulunamadı.");

    let fullText = "";
    
    for (let i = 0; i < targetPages.length; i++) {
      const pageNum = targetPages[i];
      setAiStatus(`Okunuyor: Sayfa ${pageNum} (${i+1}/${targetPages.length})`);
      
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      fullText += ` ${textContent.items.map(item => item.str).join(' ')}`;
    }

    // Temizlik
    return fullText
  .replace(/\\/g, " ")
  .replace(/\s+/g, " ")
  .trim();
};

const generateNotes = async () => {
  if (!pdfFile) {
    alert("PDF Yok!");
    return;
  }

  setAiLoading(true);

  try {
    const rawText = await extractTextFromPDF(pdfFile);

    setAiStatus("Gemini Not Çıkarıyor...");

    const prompt = `
Sen uzman bir tıp asistanısın.
Şu metni (${pageRange ? "Seçili Sayfalar" : "Tüm Doküman"}) HTML formatında, renkli ders notuna çevir.

Kurallar:
1. <h1>, <h2>, <ul>, <li>, <blockquote> kullan.
2. Önemli uyarıları <span style="color: #dc2626;">#SINAV</span>
3. Hoca vurgularını <span style="color: #2563eb;">#HOCA</span>
4. Ek bilgileri <span style="color: #16a34a;">(Ek Bilgi)</span> ile işaretle.

Metin:
"${rawText.substring(0, 30000)}..."
`;

    const result = await model.generateContent(prompt);

    const htmlNotes = result.response
      .text()
      .replace(/```html|```/g, "")
      .trim();

    editor.chain().focus().setContent(htmlNotes).run();

  } catch (e) {
    alert("Hata: " + e.message);
  } finally {
    setAiLoading(false);
    setAiStatus("");
  }
};

  // Araçlar
  const setTeacherNote = () => editor?.chain().focus().setColor('#2563eb').insertContent(' #HOCA ').run();
  const setExamAlert = () => editor?.chain().focus().setColor('#dc2626').insertContent(' #SINAV ').run();
  const setExtraInfo = () => editor?.chain().focus().setColor('#16a34a').insertContent(' (Ek Bilgi) ').run();

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file && editor) {
      const reader = new FileReader();
      reader.onload = (ev) => editor.chain().focus().setImage({ src: ev.target.result }).run();
      reader.readAsDataURL(file);
    }
  };

  const downloadPDF = () => {
    const element = document.querySelector('.ProseMirror');
    html2pdf().set({ margin: 10, filename: `${noteTitle}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(element).save();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f172a] text-slate-100 font-sans">
      
      {/* Mobil Toggle */}
      <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="md:hidden absolute top-3 left-3 z-50 p-2 bg-slate-800 rounded shadow border border-slate-700">
        {isSidebarOpen ? <X size={20}/> : <Menu size={20}/>}
      </button>

      {/* SOL PANEL (PDF) */}
      <div className={`${isSidebarOpen ? 'w-full md:w-5/12' : 'hidden'} md:flex flex-col border-r border-slate-700 bg-[#1e293b] absolute md:relative z-40 h-full shadow-2xl`}>
        <div className="h-auto py-3 border-b border-slate-700 flex flex-col gap-3 px-4 bg-[#1e293b] pl-14 md:pl-4">
           {/* Üst Satır: Yükle & Zoom */}
           <div className="flex items-center justify-between w-full">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs md:text-sm flex items-center gap-2 shadow font-medium">
                  <Upload size={16}/> <span className="hidden sm:inline">Yükle</span>
                  <input type="file" onChange={(e) => setPdfFile(e.target.files[0])} accept=".pdf" className="hidden" />
              </label>
              
              {pdfFile && (
                <div className="flex items-center gap-1 bg-slate-900/60 rounded p-1 border border-slate-600">
                    <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomOut size={16}/></button>
                    <button onClick={() => setScale(s => Math.min(2.5, s + 0.1))} className="p-1 hover:bg-slate-700 rounded text-slate-300"><ZoomIn size={16}/></button>
                </div>
              )}
           </div>

           {/* Alt Satır: Sayfa Aralığı (Lippincott Modu) */}
           {pdfFile && (
             <div className="flex items-center gap-2 bg-slate-900/40 p-1.5 rounded border border-slate-700">
                <Printer size={14} className="text-slate-400"/>
                <input 
                  type="text" 
                  placeholder="Sayfa: 1-10, 25" 
                  value={pageRange}
                  onChange={(e) => setPageRange(e.target.value)}
                  className="bg-transparent text-xs text-white placeholder-slate-500 outline-none w-full"
                />
             </div>
           )}
        </div>
        
        <div className="flex-1 bg-[#0f172a]/50 overflow-auto flex justify-center p-4 pdf-scroll">
            {!pdfFile ? (
                <div className="text-slate-500 flex flex-col items-center justify-center h-full opacity-40 gap-2">
                    <FileText size={48}/>
                    <p className="text-sm">PDF Yükle</p>
                </div>
            ) : (
                <Document file={pdfFile} onLoadSuccess={({ numPages }) => setNumPages(numPages)} className="flex flex-col gap-4 w-full">
                    {/* Sadece görünür olması gereken sayfalar değil, hepsi yüklenir ama scroll ile gezilir */}
                    {Array.from(new Array(numPages), (el, index) => (
                        <Page 
                          key={`page_${index + 1}`} 
                          pageNumber={index + 1} 
                          scale={scale} 
                          renderTextLayer={false} 
                          renderAnnotationLayer={false} 
                          className="shadow-lg border border-slate-700 w-full" 
                        />
                    ))}
                </Document>
            )}
        </div>
      </div>

      {/* SAĞ PANEL (Editör) */}
      <div className={`flex-1 flex flex-col h-full bg-[#0f172a] relative w-full overflow-hidden`}>
        <div className="h-16 border-b border-slate-700 bg-[#1e293b] flex items-center justify-between px-4 shadow-lg z-20 gap-2 overflow-x-auto no-scrollbar min-h-[64px]">
          <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} className="bg-transparent font-bold text-white outline-none w-32 md:w-56 placeholder-slate-500 text-lg truncate" placeholder="Başlık"/>
          
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex bg-slate-900/50 rounded-lg p-1 border border-slate-700">
                <button onClick={setTeacherNote} className="w-7 h-7 rounded bg-blue-500/10 text-blue-400 font-bold text-xs border border-blue-500/20 hover:bg-blue-500 hover:text-white transition">#H</button>
                <div className="w-px bg-slate-700 mx-1"></div>
                <button onClick={setExamAlert} className="w-7 h-7 rounded bg-red-500/10 text-red-400 font-bold text-xs border border-red-500/20 hover:bg-red-500 hover:text-white transition">#S</button>
                <div className="w-px bg-slate-700 mx-1"></div>
                <button onClick={setExtraInfo} className="w-7 h-7 rounded bg-green-500/10 text-green-400 font-bold text-xs border border-green-500/20 hover:bg-green-500 hover:text-white transition">Ek</button>
            </div>

            <label className="p-2 text-slate-400 hover:bg-slate-700 rounded cursor-pointer transition hidden sm:block">
                <ImageIcon size={20} />
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>

            <button onClick={generateNotes} disabled={aiLoading} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold shadow-lg shadow-indigo-500/20 transition disabled:opacity-50">
                {aiLoading ? <Loader2 size={16} className="animate-spin"/> : <Wand2 size={16}/>}
                <span className="hidden sm:inline">{aiLoading ? aiStatus : "AI Not"}</span>
            </button>
            
            <button onClick={downloadPDF} className="p-2 text-emerald-400 hover:bg-emerald-900/30 rounded transition" title="İndir">
              <Download size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#0f172a] p-2 md:p-8 flex justify-center cursor-text relative" onClick={() => editor?.commands.focus()}>
            <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export default App;