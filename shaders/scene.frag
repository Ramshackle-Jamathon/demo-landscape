precision mediump float;
// Lorn Landscape Fragment Shader
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
// It uses binary subdivision to accurately find the height map.
// Lots of thanks to Iñigo(IQ) for his noise functions and David Hoskins for his terrain raymarching examples!

uniform vec2 uResolution;
uniform vec3 uCamPosition;
uniform vec3 uCamDir;
uniform vec3 uCamUp;
uniform float uContrast;
uniform float uSaturation;
uniform float uBrightness;
uniform float uViewDistance;
uniform int uHighDetail;

varying vec2 vPos;


vec3 sunLight  = normalize( vec3(  0.4, 0.4,  0.48 ) );
vec3 sunColour = vec3(1.0, .9, .83);
float specular = 0.0;
float ambient;
vec2 add = vec2(1.0, 0.0);
#define MOD2 vec2(3.07965, 7.4235)

// This peturbs the fractal positions for each iteration down...
// Helps make nice twisted landscapes...
const mat2 rotate2D = mat2(1.3623, 1.7531, -1.7131, 1.4623);
// Alternative rotation:-
// const mat2 rotate2D = mat2(1.2323, 1.999231, -1.999231, 1.22);

//--------------------------------------------------------------------------
// IQ's noise functions, super clutch
float Hash12(vec2 p)
{
    p  = fract(p / MOD2);
    p += dot(p.xy, p.yx+19.19);
    return fract(p.x * p.y);
}

float Noise( in vec2 x )
{
    vec2 p = floor(x);
    vec2 f = fract(x);
    f = f*f*(3.0-2.0*f);
    float res = mix(mix( Hash12(p),          Hash12(p + add.xy),f.x),
                    mix( Hash12(p + add.yx), Hash12(p + add.xx),f.x),f.y);
    return res;
}

//--------------------------------------------------------------------------
// Thanks to IQ for all the noise stuff...
float Terrain(in vec2 p)
{
    vec2 pos = p*0.05;
    float w = (Noise(pos*.25)*0.75+.15);
    w = 66.0 * w * w;
    vec2 dxy = vec2(0.0, 0.0);
    float f = .0;
    for (int i = 0; i < 5; i++)
    {
        f += w * Noise(pos);
        w = -w * 0.4;   //...Flip negative and positive for variation
        pos = rotate2D * pos;
    }
    if(uHighDetail > 0){
        float ff = Noise(pos*.002);
        f += pow(abs(ff), 5.0)*275.-5.0;
    }
    return f;
    //return length(p)-4.0;
    //return  cos(p.x) * cos(p.y) ;
}
//--------------------------------------------------------------------------
// Map to lower resolution for height field mapping for Scene function...
float Map(in vec3 p)
{
    float h = Terrain(p.xz);
    return p.y - h;
}


//--------------------------------------------------------------------------
// Grab all sky information for a given ray from camera
vec3 GetSky(in vec3 rd)
{
    float sunAmount = max( dot( rd, sunLight), 0.0 );
    float v = pow(0.0-max(rd.y,0.0),5.)*.5;
    vec3  sky = vec3(v*sunColour.x*0.4+0.18, v*sunColour.y*0.4+0.22, v*sunColour.z*0.4+.4);
    // Wide glare effect...
    sky = sky + sunColour * pow(sunAmount, 6.5)*.32;
    // Actual sun...
    sky = sky+ sunColour * min(pow(sunAmount, 1150.0), .3)*.65;
    return sky;
}

//--------------------------------------------------------------------------
// Merge mountains into the sky background for correct disappearance...
vec3 ApplyFog( in vec3  rgb, in float dis, in vec3 dir)
{
    float fogAmount = exp(-dis* 0.00005);
    return mix((GetSky(dir)),   (rgb), (fogAmount) );
}

//--------------------------------------------------------------------------
// Calculate sun light...
void DoLighting(inout vec3 mat, in vec3 pos, in vec3 normal, in vec3 eyeDir, in float dis)
{
    float h = dot(sunLight,normal);
    float c = max(h, 0.0)+ambient;
    mat = mat * sunColour * c ;
    // Specular...
    if (h > 0.0)
    {
        vec3 R = reflect(sunLight, normal);
        float specAmount = pow( max(dot(R, normalize(eyeDir)), 0.0), 3.0)*specular;
        mat = mix(mat, sunColour, specAmount);
    }
}

//--------------------------------------------------------------------------
// Hack the height, position, and normal data to create the coloured landscape
vec3 TerrainColour(vec3 pos, vec3 normal, float dis)
{
    vec3 mat;
    specular = .0;
    ambient = .1;
    vec3 dir = normalize(pos-uCamPosition);
    
    vec3 matPos = pos * 2.0;// ... I had change scale halfway though, this lazy multiply allow me to keep the graphic scales I had

    float disSqrd = dis * dis;// Squaring it gives better distance scales.
  
    float f = clamp(Noise(matPos.xz*.05), 0.0,1.0);//*10.8;
    f += Noise(matPos.xz*.1+normal.yz*1.08)*.85;

    //feelin da beat
    vec3 m = mix(vec3(.63*f+.2, .7*f+.1, .7*f+.1), vec3(f*.43+.1, f*.3+.2, f*.35+.1), f);
    mat = m*vec3(f*m.x+.36, f*m.y+.30, f*m.z+.28);

    //lighting
    DoLighting(mat, pos, normal,dir, disSqrd);
    
    // Do the "water"
    if (matPos.y < 0.0)
    {
        vec3 watPos = matPos;
        mat = mix(mat, vec3(.5,.6,1.0)*.7, clamp((watPos.y-matPos.y)*.35, .1, .9));
    }
    
    //fog
    float fogAmount = exp(-dis* 0.002);
    mat = mix(vec3(.5,.6,1.0), normalize(mat), fogAmount );

    return mat;
}

//--------------------------------------------------------------------------
float BinarySubdivision(in vec3 rO, in vec3 rD, vec2 t)
{
    // Home in on the surface by dividing by two and split...
    float halfwayT;
    for (int n = 0; n < 4; n++)
    {
        halfwayT = (t.x + t.y) * .5;
        vec3 p = rO + halfwayT*rD;
        if (Map(p) < 0.5)
        {
            t.x = halfwayT;
        }else
        {
            t.y = halfwayT;
        }
    }
    return t.x;
}

//--------------------------------------------------------------------------
//Where Raymarching occurs
//https://en.wikipedia.org/wiki/Volume_ray_casting
//1. cast *single* ray in direction rD with orientation rO
//2. interpolate along line until close to surface
//3. calculate hit samples (binary subdivision) things get funky here
// returns bool fin (hit/miss) and resT (the distance along the cast ray)
bool Scene(in vec3 rO, in vec3 rD, out float resT, in vec2 fragCoord )
{
    float t = 1.2 + Hash12(fragCoord.xy);
    float oldT = 0.0;
    float delta = 0.0;
    bool fin = false;
    bool res = false;
    vec2 distances;
    for( int j=0; j< 300; j++ )
    {
        if (fin || t > uViewDistance) break;
        vec3 p = rO + t*rD;
        float h = Map(p); // ...Get this positions height mapping.
        // Are we inside, and close enough to fudge a hit?...
        if(h < 0.001)
        {
            fin = true;
            distances = vec2(t, oldT);
            break;
        }
        // Delta ray advance - a fudge between the height returned
        // and the distance already travelled.
        // It's a really fiddly compromise between speed and accuracy
        // Too large a step and the tops of ridges get missed.
        delta = max(0.01, 0.3*h) + (t*0.00085);
        oldT = t;
        t += delta;
    }
    if (fin) resT = BinarySubdivision(rO, rD, distances);

    return fin;
}

//--------------------------------------------------------------------------
// Some would say, most of the magic is done in post! :D
vec3 PostEffects(vec3 rgb, vec2 uv)
{
    return mix(vec3(.5), mix(vec3(dot(vec3(.2125, .7154, .0721), rgb*uBrightness)), rgb*uBrightness, uSaturation), uContrast);
}

//--------------------------------------------------------------------------
void main()
{
    vec2 uv = vPos; // get fragment location
    uv.x *= uResolution.x / uResolution.y;// correct for aspect ratio

    //camera vectors (position, look, up)
    vec3 cPos = vec3(uCamPosition.x,uCamPosition.y,uCamPosition.z);
    cPos.y = max(cPos.y, Terrain(cPos.xz) + 2.0);
    vec3 cUp  = vec3(uCamUp.x,uCamUp.y,uCamUp.z);
    vec3 cLook = cPos+vec3(uCamDir.x,uCamDir.y,uCamDir.z);
    
    // camera matrix
    vec3 ww = normalize( cLook-cPos );
    vec3 uu = normalize( cross(ww, cUp) );
    vec3 vv = normalize( cross(uu, ww) );
    
    vec3 rd = normalize( uv.x*uu + uv.y*vv + ww ); //direction of our ray

    vec3 col;
    float distance;
    if( !Scene(cPos,rd, distance, vPos) )
    {
        col = GetSky(rd); // Missed scene, now just get the sky value...
    }
    else
    {
        // Get world coordinate of landscape...
        vec3 pos = cPos + distance * rd;
        // Get normal from sampling the high definition height map
        // Use the distance to sample larger gaps to help stop aliasing...
        float p = min(.3, .0005+.00005 * distance*distance);
        vec3 nor    = vec3(0.0,         Terrain(pos.xz), 0.0);
        vec3 v2     = nor-vec3(p,       Terrain(pos.xz+vec2(p,0.0)), 0.0);
        vec3 v3     = nor-vec3(0.0,     Terrain(pos.xz+vec2(0.0,-p)), -p);
        nor = cross(v2, v3);
        nor = normalize(nor);

        // Get the colour using all available data...
        col = TerrainColour(pos, nor, distance);
    }

    col = PostEffects(col, uv);
    
    gl_FragColor=vec4(col,1.0);
}

//--------------------------------------------------------------------------