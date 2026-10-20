import { TextInput } from "react-native";

/** Filter field above a long repository list, styled like the branch search field. */
export function RepositoryFilterField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel="Filter repositories"
      className="mb-3 h-12 rounded-full border border-input-border bg-input px-4 font-sans text-base text-foreground"
      selectionColorClassName="accent-focus/32"
      cursorColorClassName="accent-focus"
      selectionHandleColorClassName="accent-focus"
      onChangeText={props.onChange}
      placeholder="Filter repositories"
      placeholderTextColorClassName="accent-placeholder"
      value={props.value}
    />
  );
}
