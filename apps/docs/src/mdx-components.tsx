import type { MDXComponents } from 'mdx/types';

import defaultMdxComponents from 'fumadocs-ui/mdx';

import {
  ComponentExample,
  ComponentPreview,
} from './components/component-preview';
import { ImageZoom } from './components/image-zoom';
import { UserNavDemo } from './components/user-nav-demo';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ComponentPreview,
    ComponentExample,
    UserNavDemo,
    img: (props) => <ImageZoom {...(props as any)} />,
    ...components,
  };
}
