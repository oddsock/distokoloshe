/** Extract initials from a room name, e.g. "General" → "G", "Mike Chat" → "MC" */
export function getRoomInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return words
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Toggle dark/light theme */
export function toggleTheme(): 'dark' | 'light' {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', next === 'dark');
  localStorage.setItem('distokoloshe_theme', next);
  return next;
}

export function getTheme(): 'dark' | 'light' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
