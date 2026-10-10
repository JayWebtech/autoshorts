export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
