"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import PhoneInput, {
  getCountryCallingCode,
  type Country,
  type Value,
} from "react-phone-number-input";
import enLabels from "react-phone-number-input/locale/en.json";
import koLabels from "react-phone-number-input/locale/ko.json";

import type { FanLocale } from "@/components/fan-shell/fan-app-shell";

import styles from "./recipient-phone-field.module.css";

type CountryOption = {
  value?: Country;
  label: string;
  divider?: boolean;
};

type CountrySelectProps = {
  value?: Country;
  onChange(value?: Country): void;
  onFocus?(): void;
  onBlur?(): void;
  options: CountryOption[];
  disabled?: boolean;
  readOnly?: boolean;
  locale: FanLocale;
};

const selectCopy = {
  ko: {
    label: "국가번호",
    search: "국가명 또는 국가번호 검색",
    empty: "검색 결과가 없어요.",
    selected: "선택됨",
  },
  en: {
    label: "Country calling code",
    search: "Search country or calling code",
    empty: "No countries found.",
    selected: "Selected",
  },
} as const;

function SearchableCountrySelect({
  value,
  onChange,
  onFocus,
  onBlur,
  options,
  disabled,
  readOnly,
  locale,
}: CountrySelectProps) {
  const t = selectCopy[locale];
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreFocusOnClose = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const countryOptions = useMemo(
    () => options.filter((option): option is CountryOption & { value: Country } => Boolean(option.value) && !option.divider),
    [options],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale === "ko" ? "ko-KR" : "en-US").replace(/^\+/, "");
    if (!normalized) return countryOptions;
    return countryOptions.filter((option) => {
      const callingCode = getCountryCallingCode(option.value);
      return option.label.toLocaleLowerCase(locale === "ko" ? "ko-KR" : "en-US").includes(normalized)
        || option.value.toLowerCase().includes(normalized)
        || callingCode.includes(normalized);
    });
  }, [countryOptions, locale, query]);
  const selectedIndex = Math.max(0, filtered.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = countryOptions.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, filtered.findIndex((option) => option.value === value)));
  }, [filtered, open, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open && restoreFocusOnClose.current) {
      restoreFocusOnClose.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  function showOptions() {
    if (disabled || readOnly) return;
    setQuery("");
    setOpen(true);
    onFocus?.();
    queueMicrotask(() => searchRef.current?.focus());
  }

  function hideOptions(restoreFocus = false) {
    if (restoreFocus) restoreFocusOnClose.current = true;
    setOpen(false);
    onBlur?.();
  }

  function choose(country: Country) {
    onChange(country);
    hideOptions(true);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => filtered.length ? (current + 1) % filtered.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => filtered.length ? (current - 1 + filtered.length) % filtered.length : 0);
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hideOptions(true);
    }
  }

  return <div className={styles.countrySelect} ref={rootRef}>
    <button
      ref={triggerRef}
      type="button"
      className={styles.countryTrigger}
      role="combobox"
      aria-label={t.label}
      aria-expanded={open}
      aria-controls={listboxId}
      aria-haspopup="listbox"
      disabled={disabled || readOnly}
      onClick={() => open ? hideOptions() : showOptions()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          showOptions();
        }
      }}
    >
      <span aria-hidden="true">{value ?? "KR"}</span>
      <strong>+{getCountryCallingCode(value ?? "KR")}</strong>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div className={styles.countryPopup}>
      <label className={styles.countrySearch}>
        <Search aria-hidden="true" />
        <span className={styles.visuallyHidden}>{t.search}</span>
        <input
          ref={searchRef}
          value={query}
          placeholder={t.search}
          aria-controls={listboxId}
          aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].value}` : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </label>
      <div className={styles.countryOptions} id={listboxId} role="listbox" aria-label={t.label}>
        {filtered.length ? filtered.map((option, index) => <button
          key={option.value}
          id={`${listboxId}-${option.value}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={index === activeIndex ? styles.countryOptionActive : styles.countryOption}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option.value)}
        >
          <span>{option.label}</span>
          <small>{option.value} · +{getCountryCallingCode(option.value)}</small>
          {option.value === value ? <Check aria-label={t.selected} /> : null}
        </button>) : <p className={styles.countryEmpty}>{t.empty}</p>}
      </div>
    </div> : null}
    <span className={styles.visuallyHidden} aria-live="polite">
      {selected ? `${selected.label}, +${getCountryCallingCode(selected.value)}` : ""}
    </span>
  </div>;
}

export function RecipientPhoneField({
  id,
  locale,
  label,
  requiredLabel,
  country,
  value,
  onCountryChange,
  onChange,
  disabled = false,
  error,
  inputRef,
}: {
  id: string;
  locale: FanLocale;
  label: string;
  requiredLabel: string;
  country: Country;
  value: string;
  onCountryChange(country: Country): void;
  onChange(value: string): void;
  disabled?: boolean;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const errorId = `${id}-error`;
  const labels = locale === "ko" ? koLabels : enLabels;

  return <div className={styles.field}>
    <label htmlFor={id}><span>{label}</span><small>{requiredLabel}</small></label>
    <PhoneInput
      inputRef={inputRef}
      id={id}
      className={styles.phoneInput}
      defaultCountry={country}
      labels={labels}
      addInternationalOption={false}
      countrySelectComponent={SearchableCountrySelect}
      countrySelectProps={{ locale }}
      focusInputOnCountrySelection={false}
      value={value as Value || undefined}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onCountryChange={(nextCountry) => {
        if (nextCountry) onCountryChange(nextCountry);
      }}
      disabled={disabled}
      required
      autoComplete="tel"
      inputMode="tel"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
    />
    {error ? <em id={errorId}>{error}</em> : null}
  </div>;
}
