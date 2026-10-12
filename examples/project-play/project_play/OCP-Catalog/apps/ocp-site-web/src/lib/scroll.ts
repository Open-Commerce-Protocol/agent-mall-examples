export function scrollToElementById(id: string) {
  if (!id) return;

  const attempt = () => {
    const element = document.getElementById(id);
    if (!element) return false;

    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  };

  if (attempt()) return;

  requestAnimationFrame(() => {
    void attempt();
  });
}
