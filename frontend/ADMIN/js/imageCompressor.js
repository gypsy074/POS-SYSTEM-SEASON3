/* ==========================================================================
   imageCompressor.js — Canvas-based image compression utility
   ========================================================================== */

/**
 * Compresses an image File using an off-screen Canvas.
 * Automatically applies a second pass if the first output is still too large.
 * @param {File}   file    - The image file to compress
 * @param {number} maxPx   - Max width or height in pixels (default 600)
 * @param {number} quality - JPEG quality 0.0–1.0 (default 0.6)
 * @returns {Promise<string>} Resolves with a compressed base64 data URL
 */
function compressImage(file, maxPx = 600, quality = 0.30) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = e => {
            const img = new Image();

            img.onload = () => {
                let { width, height } = img;

                // Scale down while keeping aspect ratio
                if (width > maxPx || height > maxPx) {
                    if (width >= height) {
                        height = Math.round((height / width) * maxPx);
                        width = maxPx;
                    } else {
                        width = Math.round((width / height) * maxPx);
                        height = maxPx;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                let compressed = canvas.toDataURL("image/jpeg", quality);

                // Second pass: if still over 2MB encoded, compress harder
                const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
                if (compressed.length > MAX_BYTES) {
                    compressed = canvas.toDataURL("image/jpeg", 0.40);

                    // Third pass: if STILL over 2MB, shrink dimensions too
                    if (compressed.length > MAX_BYTES) {
                        const canvas2 = document.createElement("canvas");
                        canvas2.width = Math.round(width * 0.6);
                        canvas2.height = Math.round(height * 0.6);
                        const ctx2 = canvas2.getContext("2d");
                        ctx2.drawImage(img, 0, 0, canvas2.width, canvas2.height);
                        compressed = canvas2.toDataURL("image/jpeg", 0.40);
                    }
                }

                resolve(compressed);
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

