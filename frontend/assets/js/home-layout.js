/* Home page image layout editor. */
(() => {
  const HERO_IDS = ["hero-1", "hero-2", "hero-3", "hero-4", "hero-5", "hero-6"];
  const token = localStorage.getItem("ict_token");
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("ict_user") || "null");
  } catch (_) {
    user = null;
  }

  if (!token || !user || user.role !== "ICT Admin") return;

  const track = document.getElementById("heroTrack");
  const logo = document.querySelector('[data-home-image-id="mau-logo"]');
  if (!track) return;

  const registeredIds = new Set();
  [...track.children].forEach((slide) => {
    const id = slide.dataset.homeImageId;
    if (!id || !registeredIds.has(id)) {
      if (id) registeredIds.add(id);
      return;
    }
    slide.removeAttribute("data-home-image-id");
    slide.classList.add("home-layout-clone");
    slide.draggable = false;
  });

  let savedOrder = HERO_IDS.slice();
  let savedLogoOffset = { x: 0, y: 0 };
  let logoOffset = { x: 0, y: 0 };
  let dragging = null;
  let placeholder = null;
  let logoDrag = null;

  const apiBase =
    typeof API_BASE === "string" ? API_BASE : "http://localhost:5000/api";

  const order = () =>
    [...track.querySelectorAll("[data-home-image-id]")].map(
      (el) => el.dataset.homeImageId,
    );

  const applyOrder = (nextOrder) => {
    const slides = new Map(
      [...track.querySelectorAll("[data-home-image-id]")].map((slide) => [
        slide.dataset.homeImageId,
        slide,
      ]),
    );
    nextOrder.forEach((id) => {
      const slide = slides.get(id);
      if (slide) track.appendChild(slide);
    });
  };

  const applyLogoOffset = (offset) => {
    logoOffset = {
      x: Math.max(-14, Math.min(14, Number(offset?.x) || 0)),
      y: Math.max(-14, Math.min(14, Number(offset?.y) || 0)),
    };
    if (logo)
      logo.style.transform = `translate(${logoOffset.x}px, ${logoOffset.y}px)`;
  };

  const showToast = (message, success = true) => {
    const existing = document.querySelector(".home-layout-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "home-layout-toast";
    toast.style.borderLeftColor = success ? "#12b76a" : "#f04438";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  };

  const cleanupDrag = () => {
    if (dragging) dragging.classList.remove("is-dragging");
    if (placeholder) placeholder.remove();
    dragging = null;
    placeholder = null;
  };

  const createPlaceholder = (slide) => {
    const rect = slide.getBoundingClientRect();
    placeholder = document.createElement("div");
    placeholder.className = "home-layout-placeholder";
    placeholder.style.minHeight = `${Math.round(rect.height)}px`;
    slide.parentNode.insertBefore(placeholder, slide);
  };

  const slideFromEvent = (event) => {
    const target = event.target.closest?.("[data-home-image-id]");
    return target && target.parentElement === track && target !== dragging
      ? target
      : null;
  };

  const slideAtPoint = (x, y) =>
    [...track.querySelectorAll("[data-home-image-id]")].find((slide) => {
      if (slide === dragging) return false;
      const rect = slide.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    }) || null;

  const movePlaceholder = (target, event) => {
    if (!placeholder || !target) return;
    const rect = target.getBoundingClientRect();
    const after =
      event.clientY > rect.top + rect.height / 2 ||
      (Math.abs(event.clientY - (rect.top + rect.height / 2)) <
        rect.height / 2 &&
        event.clientX > rect.left + rect.width / 2);
    track.insertBefore(placeholder, after ? target.nextSibling : target);
  };

  const enterEditMode = () => {
    savedOrder = order();
    savedLogoOffset = { ...logoOffset };
    document
      .querySelector(".hero-section")
      ?.dispatchEvent(new Event("mouseenter"));
    document.body.classList.add("home-layout-editing");
    editButton.hidden = true;
    saveButton.hidden = false;
    cancelButton.hidden = false;
    status.textContent = "Drag images to reorder";
    track.querySelectorAll("[data-home-image-id]").forEach((slide) => {
      slide.draggable = false;
    });
  };

  const exitEditMode = () => {
    cleanupDrag();
    document.body.classList.remove("home-layout-editing");
    document
      .querySelector(".hero-section")
      ?.dispatchEvent(new Event("mouseleave"));
    editButton.hidden = false;
    saveButton.hidden = true;
    cancelButton.hidden = true;
    status.textContent = "";
    track.querySelectorAll("[data-home-image-id]").forEach((slide) => {
      slide.draggable = false;
    });
  };

  const saveLayout = async () => {
    saveButton.disabled = true;
    try {
      const response = await fetch(`${apiBase}/settings/home-layout`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ heroOrder: order(), logoOffset }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success)
        throw new Error(result.message || "Unable to save the Home layout.");
      savedOrder = order();
      savedLogoOffset = { ...logoOffset };
      exitEditMode();
      showToast("Home image layout saved.");
    } catch (error) {
      showToast(error.message || "Unable to save the Home layout.", false);
    } finally {
      saveButton.disabled = false;
    }
  };

  const toolbar = document.createElement("div");
  toolbar.className = "home-layout-toolbar";
  toolbar.innerHTML = `
    <span class="home-layout-status" aria-live="polite"></span>
    <button type="button" class="home-layout-edit-button">Edit Layout</button>
    <button type="button" class="home-layout-save-button" hidden>Save Layout</button>
    <button type="button" class="home-layout-cancel-button" hidden>Cancel</button>`;
  document.body.appendChild(toolbar);

  const status = toolbar.querySelector(".home-layout-status");
  const editButton = toolbar.querySelector(".home-layout-edit-button");
  const saveButton = toolbar.querySelector(".home-layout-save-button");
  const cancelButton = toolbar.querySelector(".home-layout-cancel-button");
  editButton.addEventListener("click", enterEditMode);
  saveButton.addEventListener("click", saveLayout);
  cancelButton.addEventListener("click", () => {
    applyOrder(savedOrder);
    applyLogoOffset(savedLogoOffset);
    exitEditMode();
  });

  track.addEventListener("pointerdown", (event) => {
    if (!document.body.classList.contains("home-layout-editing")) return;
    const slide = event.target.closest?.("[data-home-image-id]");
    if (!slide || slide.parentElement !== track) return;
    event.preventDefault();
    dragging = slide;
    createPlaceholder(slide);
    dragging.classList.add("is-dragging");
    dragging.setPointerCapture(event.pointerId);
  });

  track.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const target = slideAtPoint(event.clientX, event.clientY);
    if (target) movePlaceholder(target, event);
  });

  const finishPointerDrag = (event) => {
    if (!dragging || !placeholder) return;
    const destination = placeholder;
    dragging.remove();
    destination.replaceWith(dragging);
    cleanupDrag();
  };

  track.addEventListener("pointerup", finishPointerDrag);
  track.addEventListener("pointercancel", finishPointerDrag);

  if (logo) {
    logo.addEventListener("pointerdown", (event) => {
      if (!document.body.classList.contains("home-layout-editing")) return;
      event.preventDefault();
      try {
        logo.setPointerCapture(event.pointerId);
      } catch (_) {
        /* Synthetic browser events do not have an active pointer to capture. */
      }
      logoDrag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: { ...logoOffset },
      };
    });
    logo.addEventListener("pointermove", (event) => {
      if (!logoDrag || event.pointerId !== logoDrag.pointerId) return;
      applyLogoOffset({
        x: logoDrag.start.x + event.clientX - logoDrag.x,
        y: logoDrag.start.y + event.clientY - logoDrag.y,
      });
    });
    logo.addEventListener("pointerup", () => {
      logoDrag = null;
    });
    logo.addEventListener("pointercancel", () => {
      logoDrag = null;
    });
  }

  fetch(`${apiBase}/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((result) => {
      const layout = result?.data?.homeImageLayout;
      if (layout?.heroOrder?.length === HERO_IDS.length) {
        const valid =
          layout.heroOrder.length === new Set(layout.heroOrder).size &&
          layout.heroOrder.every((id) => HERO_IDS.includes(id));
        if (valid) {
          savedOrder = layout.heroOrder.slice();
          applyOrder(savedOrder);
        }
      }
      if (layout?.logoOffset) {
        savedLogoOffset = layout.logoOffset;
        applyLogoOffset(savedLogoOffset);
      }
    })
    .catch(() => {
      /* Keep the default Home layout when settings are unavailable. */
    });
})();
