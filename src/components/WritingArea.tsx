import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import "./WritingArea.css";

/** Keeps existing input/save semantics while giving paragraph writing room to grow. */
export const WritingArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    writingSize?: "description" | "instructions" | "long";
  }
>(function WritingArea(
  { writingSize = "instructions", className = "", onInput, ...props },
  forwardedRef,
) {
  const element = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => element.current!);
  const grow = () => {
    const field = element.current;
    if (field && field.scrollHeight > field.clientHeight)
      field.style.height = `${field.scrollHeight + 2}px`;
  };
  useLayoutEffect(grow, [props.value, props.defaultValue, props.rows]);
  return (
    <textarea
      {...props}
      ref={element}
      className={`writing-area writing-area-${writingSize} ${className}`}
      onInput={(event) => {
        grow();
        onInput?.(event);
      }}
    />
  );
});
