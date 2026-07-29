// Fotos dos acolhedores exibidas no avatar do card de lead do kanban.
// Chaves: valores de leads.acolhedor normalizados (minúsculas, sem acento).
// Nomes completos conforme profiles/teamMembers; aliases curtos só quando não colidem
// com outro membro da equipe (ex: "joao" sozinho colidiria João Manoel x João Pedro).
import analyneOliveira from '@/assets/acolhedores/analyne-oliveira.jpg';
import brunoDantas from '@/assets/acolhedores/bruno-dantas.jpg';
import grazielleAline from '@/assets/acolhedores/grazielle-aline.jpg';
import joaoManoel from '@/assets/acolhedores/joao-manoel.jpg';
import julianaPimentel from '@/assets/acolhedores/juliana-pimentel.jpg';
import luizRicardo from '@/assets/acolhedores/luiz-ricardo.jpg';

const PHOTOS: Record<string, string> = {
  'joao manoel cavalcante santana': joaoManoel,
  'joao manoel': joaoManoel,
  'analyne sousa de oliveira': analyneOliveira,
  'analyne oliveira': analyneOliveira,
  'analyne': analyneOliveira,
  'bruno wenner dantas nunes': brunoDantas,
  'bruno dantas': brunoDantas,
  'juliana clara santos pimentel': julianaPimentel,
  'juliana pimentel': julianaPimentel,
  'luiz ricardo': luizRicardo,
  'grazielle aline moreira da silva': grazielleAline,
  'grazielle aline': grazielleAline,
  'grazielle': grazielleAline,
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAcolhedorPhoto(acolhedor: string | null | undefined): string | null {
  if (!acolhedor) return null;
  return PHOTOS[normalize(acolhedor)] ?? null;
}
