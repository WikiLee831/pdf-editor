import Modal from './Modal';

export default function AboutDialog() {
  return (
    <Modal title="PDF Editor 使用說明">
      <div className="hint" style={{ fontSize: 13, color: '#2c2c2c' }}>
        <p style={{ marginTop: 0 }}>
          <b>免登入、免認證、完全離線。</b>所有功能（含 OCR）都在瀏覽器本機執行，檔案不會上傳到任何伺服器。
        </p>
        <ul style={{ paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            <b>編輯文字</b>：點選左側「編輯既有文字」，頁面上的文字會以虛線框標示，點一下即可修改；自動取樣原文字的顏色與背景。
          </li>
          <li>
            <b>新增文字 / 圖片 / 簽名</b>：使用左側工具列，或直接拖放圖片。
          </li>
          <li>
            <b>編輯圖片</b>：偵測頁面中的圖片，可移動、縮放、取代、匯出或刪除。
          </li>
          <li>
            <b>貼上圖片</b>：按 Ctrl+V 即可把剪貼簿中的圖片直接貼到目前頁面。
          </li>
          <li>
            <b>快照</b>（K）：框選區域後自動複製為圖片，也可下載 PNG 或貼成頁面上的圖片。
          </li>
          <li>
            <b>列印</b>（Ctrl+P）：可選頁面範圍，並可包含編輯內容與註解。
          </li>
          <li>
            <b>OCR</b>：辨識繁中、簡中、英文、日文；辨識後 PDF 可搜尋，辨識出的文字也能直接編輯。
          </li>
          <li>
            <b>組織頁面</b>：拖曳排序、旋轉、刪除、複製、插入空白頁或其他檔案、擷取頁面。
          </li>
          <li>
            <b>分割 / 合併</b>：依頁數、範圍、檔案大小分割；多個 PDF 與圖片合併。
          </li>
          <li>
            <b>轉換</b>：PDF → Word / PNG / JPG / TXT / HTML；圖片、Word、文字 → PDF。
          </li>
          <li>
            <b>註解</b>：螢光筆、矩形、橢圓、箭頭、手繪、白色塗改、浮水印、頁碼。
          </li>
        </ul>
        <p>
          編輯內容會在「儲存」時寫入 PDF。在支援的瀏覽器（Chrome / Edge）中，「儲存」會直接覆寫原檔。
        </p>
      </div>
    </Modal>
  );
}
