import { useEffect } from 'react';
import { useOrganization } from '@/hooks/useOrganization';

/**
 * Atualiza og:image / twitter:image em runtime com a logo do escritório.
 * Crawlers que não executam JS continuam vendo o og:image estático do index.html —
 * este componente cobre navegadores e crawlers modernos que renderizam JS.
 */
export function OrgMetaSync() {
  const { organization } = useOrganization();

  useEffect(() => {
    const url = organization?.logo_url;
    if (!url) return;

    const setMeta = (selector: string, attr: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement('meta');
        const [key, value] = selector.replace(/[[\]"]/g, '').split('=');
        el.setAttribute(key, value);
        document.head.appendChild(el);
      }
      el.setAttribute(attr, url);
    };

    setMeta('meta[property="og:image"]', 'content');
    setMeta('meta[name="twitter:image"]', 'content');

  }, [organization?.logo_url]);

  return null;
}

