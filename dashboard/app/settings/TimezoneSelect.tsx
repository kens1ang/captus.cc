// Server component on purpose: the zone list comes from the server runtime once,
// so there is no server/browser mismatch in the options on hydration.
/** Every IANA zone the runtime knows, with the current one guaranteed present even if the runtime list lacks it. */
export function TimezoneSelect({ value }: { value: string }) {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const options = zones.includes(value) ? zones : [value, ...zones];
  return (
    <select name="timezone" defaultValue={value} className="control">
      {options.map((z) => (
        <option key={z} value={z}>
          {z.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
