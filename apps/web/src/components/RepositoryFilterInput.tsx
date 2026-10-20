import { SearchIcon } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";

// Keys the menu still needs: moving to the items and closing.
const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Escape", "Tab"]);

/**
 * Filter field at the top of a repository menu. Typing stays in the field instead of driving
 * the menu's typeahead; the arrow keys still move into the list.
 */
export function RepositoryFilterInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-1 pt-1 pb-1.5">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          size="sm"
          type="search"
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          value={value}
          autoFocus
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (!MENU_KEYS.has(event.key)) event.stopPropagation();
          }}
        />
      </InputGroup>
    </div>
  );
}
