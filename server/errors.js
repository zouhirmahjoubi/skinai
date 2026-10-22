// YouCam error codes mapped to plain-language guidance. `fix` says who can fix
// it: "photo" means retake, "ref" means pick another wig/hat photo, "service"
// means try later, "setup" means the operator must act.

export class YouCamError extends Error {
  constructor(message, code, status = 502, detail) {
    super(message);
    this.name = 'YouCamError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const HAIR_GONE = 'Hair try-on needs your own hair to show in the photo. If your hair is already short or has thinned, upload a head-and-shoulders photo of you from before treatment.';

const PHOTO = {
  error_no_face: 'We could not find a face. Face the camera in good light and try again.',
  error_src_face_too_small: 'Move closer so your face fills most of the frame.',
  error_face_position_too_small: 'Move closer so your face fills most of the frame.',
  error_src_face_out_of_bound: 'Part of your face is outside the frame. Centre yourself in the oval.',
  error_face_position_out_of_boundary: 'Part of your face is outside the frame. Centre yourself in the oval.',
  error_face_position_invalid: 'Keep your whole face visible, centred and facing the camera.',
  error_lighting_dark: 'The photo is too dark. Face a window or a lamp and try again.',
  error_insufficient_lighting: 'The photo is too dark. Face a window or a lamp and try again.',
  error_below_min_image_size: 'The photo resolution is too low for this step. Try the rear camera or better light.',
  error_exceed_max_image_size: 'The photo is too large for this step.',
  exceed_max_filesize: 'The photo file is too large (10 MB max).',
  error_pose: 'Look straight at the camera with your head level.',
  error_face_pose: 'Look straight at the camera with your head level.',
  error_large_face_angle: 'Your head is turned too far. Look straight at the camera.',
  error_face_angle_invalid: 'Your head is turned too far. Look straight at the camera.',
  error_face_not_forward_facing: 'Turn to face the camera straight on.',
  error_face_parsing: 'We could not read your face clearly. Try a sharper photo with even light.',
  error_no_shoulder: 'For hair try-on, step back a little so your shoulders are in the photo.',
  error_insufficient_landmarks: 'For hair try-on, keep your face and shoulders clearly in view.',
  error_hair_too_short: HAIR_GONE,
  error_bald_image: HAIR_GONE,
  error_nsfw_content_detected: 'This photo was rejected by the safety filter.',
  error_decode_image: 'The photo could not be read. Try another one.',
  error_download_image: 'YouCam could not download that image. Check the link is public.',
  InvalidFileId: 'This photo has expired on the analysis service. Please take it again.',
};

const SERVICE = {
  CreditInsufficiency: 'Live analysis is paused: this demo’s YouCam units are used up. The sample journey on Today still works.',
  InvalidApiKey: 'The YouCam API key is missing or invalid.',
  InactiveApiKey: 'The YouCam API key has been deactivated.',
  ExpiredApiKey: 'The YouCam API key has expired.',
  InvalidAccessToken: 'The YouCam API key is missing or invalid.',
  InvalidAuthentication: 'The YouCam API key is missing or invalid.',
  RateLimitExceeded: 'Too many requests right now. Please wait a minute.',
  Timeout: 'The analysis took too long. Please try again.',
  TaskTimeout: 'The analysis took too long. Please try again.',
};

export function explain(code = '') {
  if (PHOTO[code]) return { fix: 'photo', message: PHOTO[code] };
  if (/face_angle|tilt|not_forward/.test(code)) {
    return { fix: 'photo', message: 'Keep your head level and look straight at the camera.' };
  }
  if (SERVICE[code]) {
    const fix = code === 'CreditInsufficiency' || /Auth|ApiKey|AccessToken/.test(code) ? 'setup' : 'service';
    return { fix, message: SERVICE[code] };
  }
  if (code === 'unknown_internal_error') {
    return { fix: 'photo', message: 'The service could not process this photo. Please take it again.' };
  }
  return { fix: 'service', message: 'Something went wrong on the analysis service. Please try again.' };
}
