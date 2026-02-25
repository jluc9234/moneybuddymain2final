import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

interface MapSelectorProps {
  onLocationSelect: (points: [number, number][]) => void;
  selectedPoints: [number, number][] | null;
}

const MapSelector: React.FC<MapSelectorProps> = ({ onLocationSelect, selectedPoints }) => {
  const mapRef = useRef<L.Map | null>(null);
  const currentPathRef = useRef<L.Polyline | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const listenersRef = useRef<{ down: any; move: any; up: any } | null>(null);
  
  const isDrawing = useRef(false);
  const capturedPoints = useRef<L.LatLng[]>([]);
  const [drawMode, setDrawMode] = useState(false);

  useEffect(() => {
    if (!mapRef.current) {
      mapRef.current = L.map('map', {
        zoomControl: true,
        attributionControl: false,
        dragging: true,
      }).setView([40.7128, -74.0060], 13);
      
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        opacity: 1,
      }).addTo(mapRef.current);

      // Auto-detect user location
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            mapRef.current?.setView([latitude, longitude], 14);
          },
          () => { /* keep default NYC view if denied */ },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    }
  }, []);

  // Toggle draw mode on/off
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const mapContainer = map.getContainer();

    // Remove old listeners if any
    if (listenersRef.current) {
      mapContainer.removeEventListener('mousedown', listenersRef.current.down);
      mapContainer.removeEventListener('mousemove', listenersRef.current.move);
      mapContainer.removeEventListener('mouseup', listenersRef.current.up);
      mapContainer.removeEventListener('touchstart', listenersRef.current.down);
      mapContainer.removeEventListener('touchmove', listenersRef.current.move);
      mapContainer.removeEventListener('touchend', listenersRef.current.up);
      listenersRef.current = null;
    }

    if (!drawMode) {
      map.dragging.enable();
      mapContainer.style.cursor = 'grab';
      return;
    }

    map.dragging.disable();
    mapContainer.style.cursor = 'crosshair';

    const getLatLng = (e: MouseEvent | TouchEvent) => {
      const rect = mapContainer.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const point = L.point(clientX - rect.left, clientY - rect.top);
      return map.containerPointToLatLng(point);
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawing.current = true;
      const latlng = getLatLng(e);
      capturedPoints.current = [latlng];

      if (polygonRef.current) map.removeLayer(polygonRef.current);
      if (currentPathRef.current) map.removeLayer(currentPathRef.current);

      currentPathRef.current = L.polyline([latlng], {
        color: '#bef264',
        weight: 4,
        lineJoin: 'round',
        dashArray: '1, 5',
        opacity: 0.9
      }).addTo(map);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDrawing.current || !currentPathRef.current) return;
      e.preventDefault();
      const latlng = getLatLng(e);
      const lastPoint = capturedPoints.current[capturedPoints.current.length - 1];
      if (lastPoint.distanceTo(latlng) > 5) {
        capturedPoints.current.push(latlng);
        currentPathRef.current.setLatLngs(capturedPoints.current);
      }
    };

    const onUp = () => {
      if (!isDrawing.current || capturedPoints.current.length < 3) {
        isDrawing.current = false;
        return;
      }

      isDrawing.current = false;

      const points = capturedPoints.current.map(p => [p.lat, p.lng] as [number, number]);
      if (currentPathRef.current) map.removeLayer(currentPathRef.current);
      
      polygonRef.current = L.polygon(points, {
        color: '#bef264',
        fillColor: '#bef264',
        fillOpacity: 0.4,
        weight: 3,
      }).addTo(map);

      onLocationSelect(points);
      setDrawMode(false); // auto-switch back to pan after drawing
    };

    mapContainer.addEventListener('mousedown', onDown);
    mapContainer.addEventListener('mousemove', onMove);
    mapContainer.addEventListener('mouseup', onUp);
    mapContainer.addEventListener('touchstart', onDown, { passive: false });
    mapContainer.addEventListener('touchmove', onMove, { passive: false });
    mapContainer.addEventListener('touchend', onUp);

    listenersRef.current = { down: onDown, move: onMove, up: onUp };
  }, [drawMode, onLocationSelect]);

  // Render existing polygon if selectedPoints change
  useEffect(() => {
    if (selectedPoints && selectedPoints.length > 0 && mapRef.current && !isDrawing.current) {
      const map = mapRef.current;
      if (polygonRef.current) map.removeLayer(polygonRef.current);
      
      polygonRef.current = L.polygon(selectedPoints, {
        color: '#bef264',
        fillColor: '#bef264',
        fillOpacity: 0.4,
        weight: 3
      }).addTo(map);

      map.fitBounds(polygonRef.current.getBounds(), { padding: [20, 20] });
    }
  }, [selectedPoints]);

  return (
    <div className="relative group rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      <div id="map" className="shadow-inner bg-black/50 transition-all" style={{ height: '240px' }} />
      <div className="absolute top-3 left-3 z-[1000] flex flex-col space-y-2">
        <button
          type="button"
          onClick={() => setDrawMode(!drawMode)}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] shadow-lg border transition-all ${
            drawMode
              ? 'bg-lime-400/90 text-indigo-900 border-lime-400'
              : 'bg-black/80 backdrop-blur-md text-lime-400 border-lime-400/30 hover:bg-lime-400/20'
          }`}
        >
          {drawMode ? 'Drawing...' : 'Draw Geo-Fence'}
        </button>
      </div>
      <div className="absolute bottom-3 right-3 z-[1000] bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-[9px] font-bold text-indigo-200 border border-white/10 uppercase tracking-widest pointer-events-none shadow-lg">
        {drawMode ? 'Draw your zone' : 'Pan to navigate'}
      </div>
    </div>
  );
};

export default MapSelector;
