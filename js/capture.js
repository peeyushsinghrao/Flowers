/* ===========================================================
   Capture — take a plain composited photo (camera + flower
   canvas), save it locally as a download, and upload it to
   Supabase Storage at the same time.
=========================================================== */
const CaptureModule = (function(){

  function timestampSlug(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  // Composite the mirrored video + the overlay canvas into one offscreen canvas.
  function compositeFrame(videoEl, overlayCanvas, mirrored){
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');

    ctx.save();
    if (mirrored){
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    ctx.restore();

    // overlay canvas is already drawn in screen/mirrored space, draw as-is
    ctx.drawImage(overlayCanvas, 0, 0, w, h);

    return out;
  }

  function downloadCanvas(canvas, filename){
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  }

  async function uploadBlobToSupabase(blob, path){
    const client = getSupabaseClient();
    if (!client){
      console.warn('Supabase client not ready; skipping upload.');
      return { error: new Error('Supabase client not initialized') };
    }
    const { data, error } = await client.storage
      .from(CONFIG.SUPABASE_BUCKET)
      .upload(path, blob, {
        contentType: blob.type || 'application/octet-stream',
        upsert: false,
      });
    return { data, error };
  }

  /**
   * Full capture flow: composite -> local download -> Supabase upload.
   * @returns {Promise<{localSaved:boolean, uploadError:Error|null}>}
   */
  async function captureAndSave(videoEl, overlayCanvas, mirrored, onStatus){
    const slug = timestampSlug();
    const filename = `grow-and-bloom_${slug}.png`;
    const composite = compositeFrame(videoEl, overlayCanvas, mirrored);

    // Local save (always happens immediately, doesn't wait on network)
    downloadCanvas(composite, filename);
    if (onStatus) onStatus('saved-local');

    // Upload to Supabase (async, reported separately)
    return new Promise((resolve) => {
      composite.toBlob(async (blob) => {
        if (!blob){
          resolve({ localSaved: true, uploadError: new Error('toBlob failed') });
          return;
        }
        if (onStatus) onStatus('uploading');
        const { error } = await uploadBlobToSupabase(blob, `photos/${filename}`);
        if (error){
          console.error('Supabase upload error', error);
          if (onStatus) onStatus('upload-error', error);
        } else {
          if (onStatus) onStatus('uploaded');
        }
        resolve({ localSaved: true, uploadError: error || null });
      }, 'image/png');
    });
  }

  return { captureAndSave, compositeFrame, timestampSlug };
})();
