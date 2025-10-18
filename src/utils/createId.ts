const fallbackId = () => Math.random().toString(36).slice(2, 10);

export const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return fallbackId();
};

export default createId;
