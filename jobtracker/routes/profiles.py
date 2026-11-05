"""Profiles: switching between them, adding, renaming and deleting."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException, Request

from ..profiles import DEFAULT_ID, ProfileError
from .common import back, flash, flash_url, local_path, set_profile_cookie
from .state import AppState, get_state

router = APIRouter()


def _switch_to(profile_id: str, url: str):
    response = back(url)
    set_profile_cookie(response, profile_id)
    return response


@router.post("/profiles/switch")
def switch_profile(profile: str = Form(...), next_url: str = Form("/", alias="next"), state: AppState = Depends(get_state)):
    if not state.profiles.exists(profile):
        raise HTTPException(404)
    return _switch_to(profile, local_path(next_url))        # back to the same kind of page, never to another site


@router.post("/profiles")
def add_profile(name: str = Form(""), state: AppState = Depends(get_state)):
    try:
        pid = state.profiles.create(name)
    except ProfileError as exc:
        return flash("/settings", "error", str(exc), "profiles")
    message = f"Profile {state.profiles.name(pid)} created and opened. Connect its email below."
    return _switch_to(pid, flash_url("/settings", "notice", message, "accounts"))


@router.post("/profiles/{profile_id}/rename")
def rename_profile(profile_id: str, name: str = Form(""), state: AppState = Depends(get_state)):
    try:
        state.profiles.rename(profile_id, name)
    except ProfileError as exc:
        return flash("/settings", "error", str(exc), "profiles")
    return flash("/settings", "notice", "Profile renamed.", "profiles")


@router.post("/profiles/{profile_id}/delete")
def delete_profile(request: Request, profile_id: str, confirm: str = Form(""), state: AppState = Depends(get_state)):
    if confirm != "yes":
        return flash("/settings", "error", "Tick the box to confirm. Deleting a profile removes its emails, applications and logins from this PC.", "profiles")
    name = state.profiles.name(profile_id)
    try:
        state.profiles.delete(profile_id)
    except ProfileError as exc:
        return flash("/settings", "error", str(exc), "profiles")
    response = flash("/settings", "notice", f"Profile {name} deleted.", "profiles")
    if request.state.profile == profile_id:
        set_profile_cookie(response, DEFAULT_ID)
    return response
