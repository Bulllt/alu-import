import React, { useState, useEffect } from "react";

import "./styles/imagePreview.css";
import { FaImage, FaSpinner } from "react-icons/fa";

export default function ImagePreview({ file }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadImage = async () => {
      if (!file.path) return;

      try {
        setLoading(true);
        const src = await window.electronAPI.getImageThumbnail(file.path);
        if (mounted) setImageSrc(src);
      } catch (error) {
        console.error("Error loading image:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadImage();
    return () => {
      mounted = false;
    };
  }, [file.path]);

  const handleImageClick = () => {
    if (file.path) window.electronAPI.openImage(file.path);
  };

  if (loading)
    return (
      <div className="imageLoading">
        <FaSpinner className="loadingIcon" />
      </div>
    );

  return (
    <div className="imagePreview" onClick={handleImageClick}>
      {imageSrc ? (
        <img src={imageSrc} alt="Preview" className="thumbnailImage" />
      ) : (
        <div className="imagePlaceholder">
          <FaImage className="placeholderIcon" />
        </div>
      )}
    </div>
  );
}
