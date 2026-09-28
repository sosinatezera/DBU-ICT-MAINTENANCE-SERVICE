/* Client-side hero carousel reorder tool.
   Lets any visitor drag or move the home1..home8 slides into a custom order
   on the CURRENT device. The order is persisted in localStorage and restored
   before the carousel initialises, so dots, auto-play and the seamless loop
   all follow the saved order. The admin (server-side) home layout editor is
   untouched. */
(() => {
  const STORAGE_KEY = 'ictHomeSlideOrder';
  const DEFAULT_ORDER = [
    'home1.png', 'home2.png', 'home3.png', 'home4.png',
    'home5.png', 'home6.png', 'home7.png', 'home8.png',
  ];
  const KNOWN_FILES = new Set(DEFAULT_ORDER);

  const track = document.getElementById('heroTrack');
  const toggle = document.getElementById('heroReorderToggle');
  const panel = document.getElementById('heroReorderPanel');
  if (!track || !toggle || !panel) return;

  const statusEl = panel.querySelector('.hero-reorder-status');
  const resetBtn = panel.querySelector('.hero-reorder-reset');
  const doneBtn = panel.querySelector('.hero-reorder-done');

  /* The real slides only - never the looping clone added by the carousel. */
  const realSlides = () =>
    [...track.children].filter(
      (el) => el.matches?.( '[data-home-image-file]' ) &&
        el.dataset && el.dataset.heroClone !== 'true'
    );

  const readSavedOrder = () => {
    let raw;
    try { raw = localStorage.getItem( STORAGE_KEY ); } catch ( _ ) { return null; }
    if ( !raw ) return null;
    try
    {
      const arr = JSON.parse( raw );
      if ( !Array.isArray( arr ) || arr.length !== DEFAULT_ORDER.length ) return null;
      if ( arr.some( ( f ) => typeof f !== 'string' || !KNOWN_FILES.has( f ) ) ) return null;
      if ( new Set( arr ).size !== arr.length ) return null;
      return arr;
    }
    catch ( _ ) { return null; }
  };

  const writeSavedOrder = ( order ) =>
  {
    try { localStorage.setItem( STORAGE_KEY, JSON.stringify( order ) ); return true; }
    catch ( _ ) { return false; }
  };

  const currentOrder = () => realSlides().map( ( s ) => s.dataset.homeImageFile );

  const applyOrder = ( order ) =>
  {
    const map = new Map( realSlides().map( ( s ) => [s.dataset.homeImageFile, s] ) );
    order.forEach( ( file ) =>
    {
      const slide = map.get( file );
      if ( slide ) track.appendChild( slide );
    } );
  };

  /* Restore the saved order BEFORE the inline carousel script initialises,
     so dots + clone are built from the personalised sequence. */
  const saved = readSavedOrder();
  if ( saved ) applyOrder( saved );

  const isEditing = () => document.body.classList.contains( 'hero-reorder-editing' );
  const announce = ( message ) => { if ( statusEl ) statusEl.textContent = message; };

  let dragging = null;
  let placeholder = null;

  const cleanupDrag = () =>
  {
    if ( dragging ) dragging.classList.remove( 'is-dragging' );
    if ( placeholder ) placeholder.remove();
    dragging = null;
    placeholder = null;
  };

  const moveTo = ( slide, index ) =>
  {
    const all = realSlides();
    const from = all.indexOf( slide );
    if ( from === -1 || from === index ) return;
    if ( index < 0 || index >= all.length ) return;
    const target = all[index];
    if ( index > from ) track.insertBefore( target, slide );
    else track.insertBefore( slide, target );
    refreshControls();
    announce( writeSavedOrder( currentOrder() )
      ? 'Slide order saved.'
      : 'Could not save the order on this device.' );
  };

  const refreshControls = () =>
  {
    const all = realSlides();
    all.forEach( ( slide, i ) =>
    {
      const bar = slide.querySelector( '.hero-reorder-controls' );
      if ( !bar ) return;
      bar.querySelector( '.hero-reorder-index' ).textContent = ( i + 1 ) + '/' + all.length;
      const up = bar.querySelector( '.hero-reorder-up' );
      const down = bar.querySelector( '.hero-reorder-down' );
      up.disabled = i === 0;
      down.disabled = i === all.length - 1;
      up.setAttribute( 'aria-label', 'Move ' + slide.dataset.homeImageFile + ' up' );
      down.setAttribute( 'aria-label', 'Move ' + slide.dataset.homeImageFile + ' down' );
    } );
  };

  const tileAtPoint = ( x, y ) =>
    realSlides().find( ( slide ) =>
    {
      if ( slide === dragging ) return false;
      const r = slide.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    } ) || null;

  const movePlaceholder = ( target, x, y ) =>
  {
    if ( !placeholder || !target ) return;
    const r = target.getBoundingClientRect();
    const after = y > r.top + r.height / 2 || (
      Math.abs( y - ( r.top + r.height / 2 ) ) < r.height / 2 && x > r.left + r.width / 2
    );
    track.insertBefore( placeholder, after ? target.nextSibling : target );
  };

  /* --- Pointer drag reorder (touch friendly: touch-action none via CSS) --- */
  track.addEventListener( 'pointerdown', ( e ) =>
  {
    if ( !isEditing() ) return;
    const slide = e.target.closest?.( '[data-home-image-file]' );
    if ( !slide || slide.dataset.heroClone === 'true' ) return;
    if ( e.target.closest( 'button' ) || e.target.closest( 'a' ) ) return;
    if ( !track.contains( slide ) ) return;
    e.preventDefault();
    dragging = slide;
    const rect = slide.getBoundingClientRect();
    placeholder = document.createElement( 'div' );
    placeholder.className = 'hero-reorder-placeholder';
    placeholder.style.minHeight = rect.height + 'px';
    slide.parentNode.insertBefore( placeholder, slide );
    dragging.classList.add( 'is-dragging' );
    try { slide.setPointerCapture( e.pointerId ); } catch ( _ ) { /* non-pointer event */ }
  } );

  track.addEventListener( 'pointermove', ( e ) =>
  {
    if ( !dragging ) return;
    e.preventDefault();
    const target = tileAtPoint( e.clientX, e.clientY );
    if ( target ) movePlaceholder( target, e.clientX, e.clientY );
  } );

  const finishDrag = () =>
  {
    if ( !dragging || !placeholder ) return;
    dragging.remove();
    placeholder.replaceWith( dragging );
    cleanupDrag();
    refreshControls();
    announce( writeSavedOrder( currentOrder() )
      ? 'Slide order saved.'
      : 'Could not save the order on this device.' );
  };
  document.addEventListener( 'pointerup', finishDrag );
  document.addEventListener( 'pointercancel', () => cleanupDrag() );

  /* --- Keyboard reorder (ArrowUp/ArrowDown/Home/End on a focused slide) --- */
  track.addEventListener( 'keydown', ( e ) =>
  {
    if ( !isEditing() ) return;
    const slide = e.target.closest?.( '[data-home-image-file]' );
    if ( !slide || slide.dataset.heroClone === 'true' ) return;
    if ( e.ctrlKey || e.metaKey || e.altKey ) return;
    const all = realSlides();
    let index;
    if ( e.key === 'ArrowUp' ) index = all.indexOf( slide ) - 1;
    else if ( e.key === 'ArrowDown' ) index = all.indexOf( slide ) + 1;
    else if ( e.key === 'Home' ) index = 0;
    else if ( e.key === 'End' ) index = all.length - 1;
    else return;
    e.preventDefault();
    moveTo( slide, index );
    slide.focus();
  } );

  const enterEditMode = () =>
  {
    if ( document.body.classList.contains( 'home-layout-editing' ) ) return;
    document.body.classList.add( 'hero-reorder-editing' );
    if ( window.HeroCarousel?.pause ) window.HeroCarousel.pause();
    realSlides().forEach( ( slide ) =>
    {
      const bar = document.createElement( 'div' );
      bar.className = 'hero-reorder-controls';
      const index = document.createElement( 'span' );
      index.className = 'hero-reorder-index';
      const up = document.createElement( 'button' );
      up.type = 'button';
      up.className = 'hero-reorder-btn hero-reorder-up';
      up.innerHTML = '<i class="fa-solid fa-chevron-up" aria-hidden="true"></i>';
      const down = document.createElement( 'button' );
      down.type = 'button';
      down.className = 'hero-reorder-btn hero-reorder-down';
      down.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
      up.addEventListener( 'click', () => moveTo( slide, realSlides().indexOf( slide ) - 1 ) );
      down.addEventListener( 'click', () => moveTo( slide, realSlides().indexOf( slide ) + 1 ) );
      bar.append( index, up, down );
      slide.appendChild( bar );
      slide.tabIndex = 0;
    } );
    refreshControls();
    toggle.setAttribute( 'aria-expanded', 'true' );
    toggle.querySelector( 'span' ).textContent = 'Done';
    panel.hidden = false;
    announce( 'Reorder mode. Use the arrows or drag the slides.' );
  };

  const exitEditMode = () =>
  {
    if ( !isEditing() ) return;
    cleanupDrag();
    document.body.classList.remove( 'hero-reorder-editing' );
    realSlides().forEach( ( slide ) =>
    {
      slide.removeAttribute( 'tabindex' );
      const bar = slide.querySelector( '.hero-reorder-controls' );
      if ( bar ) bar.remove();
    } );
    toggle.setAttribute( 'aria-expanded', 'false' );
    toggle.querySelector( 'span' ).textContent = 'Reorder';
    panel.hidden = true;
    announce( '' );
    if ( window.HeroCarousel )
    {
      if ( window.HeroCarousel.refreshClone ) window.HeroCarousel.refreshClone();
      if ( window.HeroCarousel.reset ) window.HeroCarousel.reset();
    }
  };

  toggle.addEventListener( 'click', () => ( isEditing() ? exitEditMode() : enterEditMode() ) );
  doneBtn?.addEventListener( 'click', exitEditMode );
  resetBtn?.addEventListener( 'click', () =>
  {
    if ( !isEditing() ) return;
    cleanupDrag();
    applyOrder( DEFAULT_ORDER );
    writeSavedOrder( DEFAULT_ORDER );
    refreshControls();
    announce( 'Slide order reset to the default.' );
  } );

  /* The homepage uses single-section view navigation (#home gets d-none when
     a nav link switches to another section). Keep the reorder controls in sync
     with the home view being visible. */
  const homeSection = document.getElementById( 'home' );
  const syncToggleVisibility = () =>
  {
    const homeVisible = homeSection && homeSection.offsetParent !== null;
    toggle.hidden = !homeVisible;
    panel.hidden = !homeVisible || panel.hidden;
    if ( !homeVisible && isEditing() ) exitEditMode();
  };
  if ( homeSection )
  {
    syncToggleVisibility();
    new MutationObserver( syncToggleVisibility ).observe( homeSection, { attributes: true } );
    window.addEventListener( 'hashchange', syncToggleVisibility );
    window.addEventListener( 'resize', syncToggleVisibility );
  }
})();