import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

export const noticeExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    link: false,
    underline: false,
  }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { target: "_blank", rel: "noreferrer" },
  }),
  Underline,
  Image.configure({ inline: false, allowBase64: false }),
];
