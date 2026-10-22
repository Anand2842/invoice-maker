// The source menus and FAQs use native checkbox/radio controls. Restore the
// observed click-away behavior while leaving their source CSS in control.
(() => {
  const menus = () => [...document.querySelectorAll('header input[id$="menu-toggle"]')];
  document.addEventListener('click', event => {
    for (const input of menus()) {
      const region = input.parentElement.parentElement;
      const backdrop = event.target.matches('[data-popover-content], .gqhRgR');
      if (input.checked && (backdrop || !region.contains(event.target))) input.checked = false;
    }
  });
})();
