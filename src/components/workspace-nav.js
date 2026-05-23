// ============================================================
// TabMod — Workspace Navigation Component
//
// Renders the horizontal workspace chip bar with "All" and
// individual workspace names + tab counts.
// ============================================================

/**
 * Render the workspace navigation bar.
 * @param {Array} workspaces - List of workspace objects
 * @param {string|null} activeId - Currently selected workspace ID (null = "All")
 * @param {function(string)} onSelect - Callback when a workspace is selected
 */
export function renderWorkspaceNav(workspaces, activeId, onSelect, onCreate) {
  const nav = document.getElementById('workspaceNav');
  if (!nav) return;

  nav.innerHTML = '';

  // "All" chip
  const allChip = createChip('All', null, activeId === null, workspaces);
  allChip.addEventListener('click', () => onSelect(null));
  nav.appendChild(allChip);

  // Workspace chips
  for (const ws of workspaces) {
    const chip = createChip(ws.name, ws.id, ws.id === activeId, workspaces);
    chip.addEventListener('click', () => onSelect(ws.id));
    nav.appendChild(chip);
  }

  // "Add" button
  const addBtn = document.createElement('button');
  addBtn.className = 'workspace-chip add-btn';
  addBtn.textContent = '+';
  addBtn.setAttribute('aria-label', 'New workspace');
  addBtn.addEventListener('click', () => {
    const name = prompt('Workspace name:');
    if (name && name.trim()) {
      if (onCreate) onCreate(name.trim());
    }
  });
  nav.appendChild(addBtn);
}

/**
 * Create a single workspace chip element.
 * @param {string} name
 * @param {string|null} id
 * @param {boolean} isActive
 * @param {Array} workspaces
 * @returns {HTMLElement}
 */
function createChip(name, id, isActive, workspaces) {
  const chip = document.createElement('button');
  chip.className = `workspace-chip${isActive ? ' active' : ''}`;
  chip.setAttribute('role', 'tab');
  chip.setAttribute('aria-selected', String(isActive));

  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  chip.appendChild(nameSpan);

  // Count badge
  const count = document.createElement('span');
  count.className = 'count';
  if (id === null) {
    // "All" — sum of all workspace tabs
    count.textContent = workspaces.reduce((sum, ws) => sum + (ws.tabs?.length || 0), 0);
  } else {
    const ws = workspaces.find((w) => w.id === id);
    count.textContent = ws?.tabs?.length || 0;
  }
  chip.appendChild(count);

  return chip;
}
