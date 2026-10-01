/* ============================================================
   device-type-select.js — Reusable searchable, grouped Device Type
   combobox (vanilla JS, no dependencies)

   Used by the requester's New Request form and the admin device-type
   management page. One component, one behaviour:

     • Optional — the value may be left empty. The trigger shows
       "Select Device Type (Optional)" and the field is never required
       unless "Other ICT Device" is chosen.
     • Searchable — typing filters across device names AND categories.
     • Grouped — active device types are rendered under their category
       headings, in the server-provided order.
     • Safe loading — a small spinner shows ONLY while fetching. It can
       never get stuck: the request is wrapped in a hard timeout, and any
       failure (network, 5xx, timeout, empty list) leaves the request form
       fully usable because the field is optional.
     • Cached — the active list is cached in sessionStorage with a short
       TTL so navigating between pages doesn't refetch; it is also
       re-fetchable on demand (used by the "Retry" control on failure).
   ============================================================ */

(function () {
  "use strict";

  /* The single catalogue entry that reveals the free-text device-name field.
     Must match DeviceType.OTHER_DEVICE_NAME on the backend. */
  const OTHER_DEVICE_NAME = "Other ICT Device";

  const CACHE_KEY = "ict_device_types_cache";
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const FETCH_TIMEOUT_MS = 8000;

  /* ── Cache helpers (sessionStorage, short TTL) ─────────────── */
  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.groups)) return null;
      /* parsed.ts is the CREATION timestamp written by writeCache(), so the
         expiry test must ADD the TTL. Comparing Date.now() > parsed.ts alone
         is unconditionally true (now is always later than the moment of
         writing), which made every cached read miss and left CACHE_TTL_MS
         unreferenced. */
      if (Date.now() > parsed.ts + CACHE_TTL_MS) {
        sessionStorage.removeItem(CACHE_KEY);
        return null;
      }
      return parsed.groups;
    } catch (_) {
      return null;
    }
  }

  function writeCache(groups) {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ts: Date.now(), groups: groups }),
      );
    } catch (_) {
      /* Private-mode / quota — caching is best-effort only. */
    }
  }

  function clearCache() {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch (_) {}
  }

  /* ── Fetch the active, grouped device types ──────────────────
     Returns a Promise<groups> that ALWAYS settles:
       • resolves with the grouped array on success
       • rejects with an Error on any failure (caller shows a non-blocking
         message; the optional field stays usable either way)
     A hard timeout guarantees settlement even if the underlying request
     never resolves. */
  function fetchDeviceTypes({ force = false } = {}) {
    if (!force) {
      const cached = readCache();
      if (cached) return Promise.resolve(cached);
    }
    clearCache();

    const request = apiRequest("/device-types").then((res) => {
      const groups =
        res && res.success && Array.isArray(res.data) ? res.data : [];
      writeCache(groups);
      return groups;
    });

    /* Hard settle-guard: whichever fires first wins, so the caller is never
       left awaiting forever. */
    return Promise.race([
      request,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Device list request timed out.")),
          FETCH_TIMEOUT_MS,
        ),
      ),
    ]);
  }

  /* ── Combobox ───────────────────────────────────────────────
     opts:
       inputSelector   — the text input that shows the selection / search
       menuSelector    — the container the option list renders into
       hiddenSelector  — a hidden input holding the committed value
       onChange(value) — called with the committed value ("" when cleared)
       placeholder     — trigger text when nothing is selected
   */
  function createDeviceTypeSelect(opts) {
    const {
      inputSelector,
      menuSelector,
      hiddenSelector,
      statusSelector = null,
      onChange = () => {},
      placeholder = "Select Device Type (Optional)",
    } = opts;

    const input = document.querySelector(inputSelector);
    const menu = document.querySelector(menuSelector);
    const hidden = hiddenSelector
      ? document.querySelector(hiddenSelector)
      : null;
    const status = statusSelector
      ? document.querySelector(statusSelector)
      : null;
    if (!input || !menu) return null;

    let groups = [];
    let value = "";
    let open = false;
    let activeIndex = -1;
    /* Flat list of currently visible options, each a DOM element we attach
       the option metadata to, so keyboard navigation is trivial. */
    let visible = [];

    /* ── Rendering ─────────────────────────────────────────── */
    function optionLabel(opt) {
      return opt.name;
    }

    function buildMenu(filterText) {
      const q = (filterText || "").trim().toLowerCase();
      menu.innerHTML = "";
      visible = [];

      const frag = document.createDocumentFragment();
      let any = false;

      for (const group of groups) {
        const devices = (group.devices || []).filter((d) => {
          if (!q) return true;
          return (
            d.name.toLowerCase().includes(q) ||
            group.category.toLowerCase().includes(q)
          );
        });
        if (!devices.length) continue;
        any = true;

        const header = document.createElement("div");
        header.className = "dts-group-header";
        header.textContent = group.category;
        frag.appendChild(header);

        for (const device of devices) {
          const opt = document.createElement("button");
          opt.type = "button";
          opt.className = "dts-option";
          opt.setAttribute("role", "option");
          opt.textContent = optionLabel(device);
          opt.dataset.value = device.name;
          opt.dataset.group = group.category;
          if (device.name === value) {
            opt.classList.add("is-selected");
            opt.setAttribute("aria-selected", "true");
          }
          frag.appendChild(opt);
          visible.push(opt);
        }
      }

      if (!any) {
        const empty = document.createElement("div");
        empty.className = "dts-empty";
        empty.textContent = q
          ? "No matching device found."
          : "No device types are available right now.";
        frag.appendChild(empty);
      }

      menu.appendChild(frag);
      activeIndex = -1;
    }

    function renderSelected() {
      input.value = value || "";
      if (!value) input.placeholder = placeholder;
      if (hidden) hidden.value = value;
    }

    function openMenu() {
      if (open) return;
      open = true;
      menu.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      /* Open showing all options, or filtered by whatever is typed. */
      buildMenu(input.dataset.search || "");
    }

    function closeMenu() {
      if (!open) return;
      open = false;
      menu.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      /* Reset the search buffer so the next open starts from the full list. */
      delete input.dataset.search;
    }

    function commit(newValue) {
      value = newValue || "";
      renderSelected();
      closeMenu();
      onChange(value);
    }

    /* ── Status line (loading / error / retry) ──────────────── */
    function setStatus(kind, message) {
      if (!status) return;
      status.className =
        "dts-status" + (kind ? " is-" + kind : "") + (message ? "" : " d-none");
      if (!message) {
        status.textContent = "";
        return;
      }
      if (kind === "error") {
        status.innerHTML =
          '<i class="bi bi-exclamation-triangle me-1"></i>' +
          '<span class="dts-status-text"></span>' +
          '<button type="button" class="btn btn-link btn-sm p-0 align-baseline dts-retry">Retry</button>';
        status.querySelector(".dts-status-text").textContent = message;
        status
          .querySelector(".dts-retry")
          .addEventListener("click", () => load({ force: true }));
      } else {
        status.innerHTML =
          '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span><span class="dts-status-text"></span>';
        status.querySelector(".dts-status-text").textContent = message;
      }
    }

    function setLoading(isLoading) {
      const wrap = input.closest(".dts");
      if (wrap) wrap.classList.toggle("is-loading", isLoading);
    }

    /* ── Load the active list (with cache + timeout + retry) ── */
    async function load({ force = false } = {}) {
      setLoading(true);
      setStatus("loading", "Loading device types...");
      try {
        groups = await fetchDeviceTypes({ force });
        /* Keep a previously committed value visible even if it was deactivated
           server-side — the ticket is not silently altered. */
        buildMenu("");
        renderSelected();
        setStatus("", "");
      } catch (err) {
        groups = [];
        buildMenu("");
        renderSelected();
        /* Non-blocking: because the field is optional, the form stays usable.
           The user simply submits without a device type. */
        setStatus("error", "Could not load device types. You can still submit without one.");
      } finally {
        setLoading(false);
      }
    }

    /* ── Events ─────────────────────────────────────────────── */
    input.addEventListener("focus", () => {
      openMenu();
    });

    input.addEventListener("input", () => {
      /* Typing searches; it does NOT change the committed value. */
      input.dataset.search = input.value;
      openMenu();
      buildMenu(input.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) {
          openMenu();
          return;
        }
        if (!visible.length) return;
        if (e.key === "ArrowDown") {
          activeIndex = (activeIndex + 1) % visible.length;
        } else {
          activeIndex =
            (activeIndex - 1 + visible.length) % visible.length;
        }
        visible.forEach((el, i) =>
          el.classList.toggle("is-active", i === activeIndex),
        );
        const active = visible[activeIndex];
        if (active) active.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        if (open && activeIndex >= 0 && visible[activeIndex]) {
          e.preventDefault();
          commit(visible[activeIndex].dataset.value);
        }
      } else if (e.key === "Escape") {
        if (open) {
          e.stopPropagation();
          closeMenu();
          /* Restore the committed label (undo any in-progress search text). */
          renderSelected();
        }
      }
    });

    /* Click an option (event delegation so re-renders are safe). */
    menu.addEventListener("mousedown", (e) => {
      const option = e.target.closest(".dts-option");
      if (!option) return;
      e.preventDefault(); // keep focus on the input
      commit(option.dataset.value);
    });

    /* Close when clicking outside. */
    document.addEventListener("click", (e) => {
      if (!open) return;
      const wrap = input.closest(".dts");
      if (wrap && !wrap.contains(e.target)) {
        closeMenu();
        renderSelected(); // discard partial search text
      }
    });

    /* ── Public API ─────────────────────────────────────────── */
    return {
      load,
      getValue: () => value,
      setValue: (v) => {
        value = v || "";
        renderSelected();
      },
      reset: () => {
        value = "";
        groups = [];
        visible = [];
        menu.innerHTML = "";
        renderSelected();
        setStatus("", "");
        setLoading(false);
      },
      destroy: () => {
        closeMenu();
      },
    };
  }

  /* Expose the module-level helpers so page code can preload or invalidate. */
  window.DeviceTypeSelect = {
    create: createDeviceTypeSelect,
    fetch: fetchDeviceTypes,
    clearCache,
    OTHER_DEVICE_NAME,
  };
})();
