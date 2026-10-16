import type { ReactNode } from 'react';

import { CANVAS_THEME, GRID_SIZE } from '@/lib/zones';

/** Blueprint foundation: slab, planar lantai, dan grid isometrik 60×60 (PRD §4.1). */
export function Floor(): ReactNode {
  return (
    <group>
      {/* Slab dasar */}
      <mesh position={[0, -0.3, 0]} receiveShadow>
        <boxGeometry args={[54, 0.6, 54]} />
        <meshPhongMaterial color={CANVAS_THEME.floorColor} specular="#1e293b" shininess={30} />
      </mesh>

      {/* Lantai penangkap shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[GRID_SIZE, GRID_SIZE]} />
        <meshPhongMaterial color="#061527" specular="#16233a" shininess={20} />
      </mesh>

      {/* Grid struktural 60×60 unit (40 sel, referensi visual) */}
      <gridHelper
        args={[GRID_SIZE, 40, CANVAS_THEME.gridColorCenter, CANVAS_THEME.gridColorCell]}
        position={[0, 0.02, 0]}
      />

      {/* Grid isometrik halus — grid line rgba(255,255,255,0.03) (AC scene dasar) */}
      <gridHelper
        args={[GRID_SIZE, 60, '#ffffff', '#ffffff']}
        position={[0, 0.03, 0]}
        material-transparent
        material-opacity={0.03}
      />
    </group>
  );
}
