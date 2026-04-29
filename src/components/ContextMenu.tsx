import { useLayoutEffect, useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const margin = 6;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    setPosition({
      left: Math.min(Math.max(margin, x), maxLeft),
      top: Math.min(Math.max(margin, y), maxTop),
    });
  }, [x, y, items]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 9999,
    maxHeight: "calc(100vh - 12px)",
    overflowY: "auto",
  };

  return (
    <div
      ref={ref}
      className="min-w-[160px] py-1 rounded shadow-lg border text-[12px]"
      style={{ ...style, background: "#fff", borderColor: "var(--moba-divider)" }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="h-px mx-2 my-1" style={{ background: "var(--moba-divider)" }} />
        ) : (
          <button
            key={i}
            className="w-full px-3 py-1 text-left flex items-center gap-2 hover:bg-[var(--moba-hover)] disabled:opacity-40"
            style={item.danger ? { color: "#b22222" } : undefined}
            onClick={() => { item.onClick(); onClose(); }}
            disabled={item.disabled}
          >
            {item.icon && <span className="w-4 flex-shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const show = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const close = () => setMenu(null);

  const render = menu ? (
    <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={close} />
  ) : null;

  return { show, close, render };
}
