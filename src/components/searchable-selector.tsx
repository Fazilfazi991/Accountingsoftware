"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchableOption = { id: string; label: string; description?: string; search?: string };

export function filterSearchableOptions(options: SearchableOption[], query: string, limit = 20) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    const haystack = `${option.label} ${option.description || ""} ${option.search || ""}`.toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).slice(0, limit);
}

export function SearchableSelector({ label, value, options, onChange, placeholder = "Search…", disabled = false,
  required = false, search }: { label: string; value: string; options: SearchableOption[]; onChange: (value: string) => void;
  placeholder?: string; disabled?: boolean; required?: boolean; search?: (query:string)=>Promise<SearchableOption[]> }) {
  const id = useId(), wrap = useRef<HTMLDivElement>(null), selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState(selected?.label || ""), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [remote,setRemote]=useState<SearchableOption[]|null>(null),requestId=useRef(0);
  useEffect(()=>{if(!search||!open||query.trim().length<1){setRemote(null);return}const current=++requestId.current,timer=window.setTimeout(()=>{void search(query).then((items)=>{if(current===requestId.current)setRemote(items)});},180);return()=>window.clearTimeout(timer)},[open,query,search]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, []);
  const results = useMemo(() => remote ?? filterSearchableOptions(options, open ? query : ""), [open, options, query,remote]);
  const choose = (option: SearchableOption) => { onChange(option.id); setQuery(option.label); setOpen(false); };
  return <label className="searchable-field">{label}<div className="searchable-selector" ref={wrap}>
    <input role="combobox" aria-controls={`${id}-list`} aria-expanded={open} aria-autocomplete="list" aria-activedescendant={open && results[active] ? `${id}-${results[active].id}` : undefined}
      required={required} disabled={disabled} value={open ? query : selected?.label || ""} placeholder={placeholder}
      onFocus={() => { setQuery(selected?.label || ""); setOpen(true); setActive(0); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, results.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && open && results[active]) { event.preventDefault(); choose(results[active]); }
        if (event.key === "Escape") setOpen(false);
      }} />
    {value && !disabled && <button type="button" className="selector-clear" aria-label={`Clear ${label}`} onClick={() => { onChange(""); setQuery(""); setOpen(true); }}>×</button>}
    {open && <div className="selector-list" id={`${id}-list`} role="listbox">
      {results.map((option, index) => <button type="button" role="option" aria-selected={option.id === value} id={`${id}-${option.id}`}
        className={index === active ? "active" : ""} key={option.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
        <b>{option.label}</b>{option.description && <small>{option.description}</small>}
      </button>)}
      {!results.length && <p>No matching records</p>}
    </div>}
  </div></label>;
}
