import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, onClose, children, drawer = false }: {
  title: string; onClose: () => void; children: ReactNode; drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={drawer ? 'dialog drawer' : 'dialog'} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-inner">
      <div className="dialog-heading"><div><span className="eyebrow">JSON FORMAT</span><h2>{title}</h2></div>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button>
      </div>
      {children}
    </div>
  </dialog>;
}
